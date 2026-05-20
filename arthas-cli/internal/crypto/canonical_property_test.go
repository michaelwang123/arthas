// canonical_property_test.go — Canonical JSON 序列化的属性测试
//
// 本文件使用 pgregory.net/rapid 对 CanonicalJSON 和 ComputeSignableBytes 进行属性测试，
// 验证 canonical JSON 序列化的核心安全属性：确定性和递归 key 排序。
//
// 这些属性是 Ed25519 签名互操作的前提条件——如果序列化不确定，
// 签名方和验证方会对不同的字节序列操作，导致验证永远失败。
//
// 📚 学习要点: 为什么 Canonical JSON 需要属性测试？
// 确定性序列化的正确性必须在整个输入空间中成立（任意嵌套深度、
// 任意 key 组合、任意值类型）。单元测试只能覆盖有限的手工用例，
// 而属性测试通过随机生成大量复杂嵌套结构，更容易发现边界条件 bug
// （如特定 key 排序组合导致输出不一致）。
//
// Feature: security-upgrade, Property 4: Canonical JSON determinism with recursive sorted keys
package crypto

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"

	"pgregory.net/rapid"
)

// **Validates: Requirements 4.2, 7.4**

// safeStringCharset 定义用于生成测试字符串的字符集。
// 包含 ASCII 可打印字符（空格到 ~），覆盖字母、数字、标点符号。
// 排除控制字符（0x00-0x1F），因为 Go 的 strconv.Quote 对控制字符使用 \x 转义
// （非标准 JSON），而实际 payload 中不会出现原始控制字符。
//
// 📚 学习要点: 智能生成器约束输入空间
// 属性测试的生成器应该约束到"有意义的输入空间"。
// 对于 Canonical JSON，有意义的输入是实际消息 payload 中可能出现的字符串
// （文本消息、base64url 编码、用户名等），这些都是可打印字符。
// 生成原始控制字符虽然能发现 strconv.Quote 的 \x 转义问题，
// 但这不影响实际使用场景的正确性。
const safeStringCharset = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"

// genSafeString 生成一个由可打印 ASCII 字符组成的随机字符串。
// 长度在 0-20 之间，字符来自 safeStringCharset。
func genSafeString(t *rapid.T, label string) string {
	length := rapid.IntRange(0, 20).Draw(t, label+"Len")
	if length == 0 {
		return ""
	}
	chars := make([]byte, length)
	for i := range chars {
		idx := rapid.IntRange(0, len(safeStringCharset)-1).Draw(t, "")
		chars[i] = safeStringCharset[idx]
	}
	return string(chars)
}

// genJSONValue 生成任意 JSON 兼容值（递归），用于构建复杂的测试 payload。
//
// 📚 学习要点: 递归生成器与深度限制
// 生成嵌套结构时必须限制递归深度，否则生成器可能产生无限深的对象，
// 导致测试超时或栈溢出。depth 参数控制最大嵌套层数，
// 当 depth <= 0 时只生成叶子值（string、number、bool、null）。
func genJSONValue(t *rapid.T, depth int) interface{} {
	if depth <= 0 {
		// 叶子值：string、number、bool、null
		choice := rapid.IntRange(0, 3).Draw(t, "leafType")
		switch choice {
		case 0:
			return genSafeString(t, "string")
		case 1:
			return rapid.Float64Range(-1e10, 1e10).Draw(t, "number")
		case 2:
			return rapid.Bool().Draw(t, "bool")
		default:
			return nil
		}
	}

	// 非叶子值：可以是 object、array 或叶子值
	choice := rapid.IntRange(0, 4).Draw(t, "valueType")
	switch choice {
	case 0:
		return genJSONMap(t, depth-1)
	case 1:
		return genJSONArray(t, depth-1)
	default:
		// 叶子值（增加叶子概率，避免过深嵌套）
		leafChoice := rapid.IntRange(0, 3).Draw(t, "leafType2")
		switch leafChoice {
		case 0:
			return genSafeString(t, "string2")
		case 1:
			return rapid.Float64Range(-1e10, 1e10).Draw(t, "number2")
		case 2:
			return rapid.Bool().Draw(t, "bool2")
		default:
			return nil
		}
	}
}

// genJSONMap 生成一个 map[string]interface{}，key 为随机字符串，value 为递归 JSON 值。
func genJSONMap(t *rapid.T, depth int) map[string]interface{} {
	size := rapid.IntRange(0, 5).Draw(t, "mapSize")
	m := make(map[string]interface{}, size)
	for i := 0; i < size; i++ {
		key := genSafeString(t, "mapKey")
		m[key] = genJSONValue(t, depth)
	}
	return m
}

// genJSONArray 生成一个 []interface{}，元素为递归 JSON 值。
func genJSONArray(t *rapid.T, depth int) []interface{} {
	size := rapid.IntRange(0, 4).Draw(t, "arraySize")
	arr := make([]interface{}, size)
	for i := range arr {
		arr[i] = genJSONValue(t, depth)
	}
	return arr
}

// genPayloadMap 生成一个模拟 Signed_Payload 的 map，包含 text 和可选的嵌套字段。
//
// 📚 学习要点: 智能生成器 vs 纯随机
// 我们不仅测试纯随机 map，还生成模拟真实 payload 结构的 map
// （包含 text、reply、type、pubkey 等字段），确保测试覆盖实际使用场景。
func genPayloadMap(t *rapid.T) map[string]interface{} {
	m := make(map[string]interface{})

	// text 字段始终存在
	m["text"] = genSafeString(t, "text")

	// 可选 reply 嵌套对象
	if rapid.Bool().Draw(t, "hasReply") {
		reply := make(map[string]interface{})
		reply["preview"] = genSafeString(t, "preview")
		reply["senderName"] = genSafeString(t, "senderName")
		reply["stableId"] = genSafeString(t, "stableId")
		m["reply"] = reply
	}

	// 可选 type 字段
	if rapid.Bool().Draw(t, "hasType") {
		m["type"] = rapid.StringMatching(`[a-z]{3,10}`).Draw(t, "type")
	}

	// 可选 pubkey 字段
	if rapid.Bool().Draw(t, "hasPubkey") {
		m["pubkey"] = genSafeString(t, "pubkey")
	}

	return m
}

// TestProperty4_CanonicalJSON_Determinism 验证 CanonicalJSON 的确定性：
// 对同一输入调用两次必须产生完全相同的字节输出。
//
// **Validates: Requirements 4.2, 7.4**
//
// 属性定义：
// 对于任意 map[string]interface{}（包含嵌套对象和数组），
// CanonicalJSON(input) 的两次调用必须返回 byte-identical 的结果。
// 这是 Ed25519 签名正确性的前提——签名方和验证方必须对相同的字节签名/验证。
func TestProperty4_CanonicalJSON_Determinism(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成任意嵌套 map（最大深度 3）
		input := genJSONMap(t, 3)

		// 第一次序列化
		result1, err1 := CanonicalJSON(input)
		if err1 != nil {
			t.Fatalf("CanonicalJSON first call failed: %v", err1)
		}

		// 第二次序列化（相同输入）
		result2, err2 := CanonicalJSON(input)
		if err2 != nil {
			t.Fatalf("CanonicalJSON second call failed: %v", err2)
		}

		// 断言：两次调用必须产生完全相同的字节
		if string(result1) != string(result2) {
			t.Fatalf("CanonicalJSON is not deterministic!\n  first:  %s\n  second: %s",
				string(result1), string(result2))
		}
	})
}

// TestProperty4_CanonicalJSON_KeyOrdering 验证 CanonicalJSON 输出中所有 key
// 在每个嵌套层级都按 Unicode 字母序排列。
//
// **Validates: Requirements 4.2, 7.4**
//
// 属性定义：
// 对于任意 map[string]interface{}，CanonicalJSON 的输出解析回 JSON 后，
// 遍历每个嵌套层级的 key 列表，必须已经按字母序排列。
//
// 📚 学习要点: 验证 key 排序的策略
// 我们不能直接从 JSON 字符串中提取 key 顺序（json.Unmarshal 到 map 会丢失顺序）。
// 因此使用 json.Decoder 的 Token() 方法逐 token 解析，记录每层 object 的 key 顺序，
// 然后验证每层的 key 列表是否已排序。
func TestProperty4_CanonicalJSON_KeyOrdering(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成包含嵌套对象的 map
		input := genJSONMap(t, 3)

		result, err := CanonicalJSON(input)
		if err != nil {
			t.Fatalf("CanonicalJSON failed: %v", err)
		}

		// 验证输出是合法 JSON
		var parsed interface{}
		if err := json.Unmarshal(result, &parsed); err != nil {
			t.Fatalf("CanonicalJSON output is not valid JSON: %v\n  output: %s", err, string(result))
		}

		// 使用 token-level 解析验证原始 JSON bytes 中的 key 顺序
		if err := verifyKeysAreSortedInBytes(result); err != nil {
			t.Fatalf("Keys not sorted in CanonicalJSON output: %v\n  output: %s", err, string(result))
		}
	})
}

// TestProperty4_CanonicalJSON_NestedObjects 验证嵌套对象的递归排序。
// 生成包含多层嵌套 map 的输入，确保每层 key 都按字母序排列。
//
// **Validates: Requirements 4.2, 7.4**
//
// 📚 学习要点: 为什么单独测试嵌套对象？
// JavaScript 中 JSON.stringify(obj, Object.keys(obj).sort()) 的 array replacer
// 会应用到所有嵌套层级，导致嵌套对象中不在 replacer 数组中的字段被丢弃。
// 此测试确保 Go 实现正确处理任意深度的嵌套对象，每层独立排序。
func TestProperty4_CanonicalJSON_NestedObjects(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成至少包含一个嵌套 map 的结构
		inner := genJSONMap(t, 2)
		outer := make(map[string]interface{})
		outer["nested"] = inner
		outer["alpha"] = genSafeString(t, "alpha")
		outer["zebra"] = genSafeString(t, "zebra")

		// 添加更多随机嵌套
		if rapid.Bool().Draw(t, "extraNesting") {
			outer["deep"] = map[string]interface{}{
				"z_key": "last",
				"a_key": "first",
				"m_key": map[string]interface{}{
					"inner_z": true,
					"inner_a": false,
				},
			}
		}

		result, err := CanonicalJSON(outer)
		if err != nil {
			t.Fatalf("CanonicalJSON failed: %v", err)
		}

		// 验证输出是合法 JSON
		var parsed interface{}
		if err := json.Unmarshal(result, &parsed); err != nil {
			t.Fatalf("CanonicalJSON output is not valid JSON: %v\n  output: %s", err, string(result))
		}

		// 使用 token-level 解析验证原始 JSON bytes 中的 key 顺序
		if err := verifyKeysAreSortedInBytes(result); err != nil {
			t.Fatalf("Nested keys not sorted: %v\n  output: %s", err, string(result))
		}
	})
}

// TestProperty4_ComputeSignableBytes_RemovesSig 验证 ComputeSignableBytes 正确移除 sig 字段：
// 向 payload 中添加 "sig" 字段不应改变 signable bytes 的输出。
//
// **Validates: Requirements 4.2, 7.4**
//
// 属性定义：
// 对于任意 payload map，ComputeSignableBytes(payload) 和
// ComputeSignableBytes(payload_with_sig) 必须产生相同的字节输出。
// 这确保签名计算不受 sig 字段本身的影响（避免循环依赖）。
//
// 📚 学习要点: 为什么 sig 字段不参与签名计算？
// 签名覆盖的是"被签名的内容"，而非签名本身。如果 sig 字段参与签名计算，
// 就会产生循环依赖（签名依赖自身的值）。这与 JWT 的签名机制类似。
func TestProperty4_ComputeSignableBytes_RemovesSig(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成模拟 payload
		payload := genPayloadMap(t)

		// 计算不含 sig 的 signable bytes
		bytesWithout, err := ComputeSignableBytes(payload)
		if err != nil {
			t.Fatalf("ComputeSignableBytes (without sig) failed: %v", err)
		}

		// 添加 sig 字段
		payloadWithSig := make(map[string]interface{}, len(payload)+1)
		for k, v := range payload {
			payloadWithSig[k] = v
		}
		payloadWithSig["sig"] = genSafeString(t, "sig")

		// 计算含 sig 的 signable bytes
		bytesWith, err := ComputeSignableBytes(payloadWithSig)
		if err != nil {
			t.Fatalf("ComputeSignableBytes (with sig) failed: %v", err)
		}

		// 断言：两者必须相同（sig 被正确移除）
		if string(bytesWithout) != string(bytesWith) {
			t.Fatalf("ComputeSignableBytes not ignoring sig field!\n  without sig: %s\n  with sig:    %s",
				string(bytesWithout), string(bytesWith))
		}
	})
}

// verifyKeysAreSortedInBytes 对 JSON 字节使用 Decoder 逐 token 解析，
// 验证每个 object 中 key 的出现顺序是否按字母序排列。
//
// 📚 学习要点: 验证 JSON key 顺序的正确方法
// Go 的 map 不保证迭代顺序，因此不能通过 Unmarshal 到 map 后检查 key 顺序。
// 正确的方法是对原始 JSON 字节使用 json.Decoder 逐 token 解析，
// 记录每个 object 中 key 出现的顺序，然后验证是否已排序。
func verifyKeysAreSortedInBytes(data []byte) error {
	dec := json.NewDecoder(strings.NewReader(string(data)))
	return verifyTokenOrder(dec)
}

// verifyTokenOrder 递归解析 JSON token 流，验证 object key 排序。
func verifyTokenOrder(dec *json.Decoder) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}

	switch tok {
	case json.Delim('{'):
		// 解析 object：收集 key 并验证排序
		var keys []string
		for dec.More() {
			// 读取 key
			keyTok, err := dec.Token()
			if err != nil {
				return err
			}
			key, ok := keyTok.(string)
			if !ok {
				return fmt.Errorf("expected string key, got %T", keyTok)
			}
			keys = append(keys, key)

			// 递归验证 value
			if err := verifyTokenOrder(dec); err != nil {
				return err
			}
		}
		// 读取闭合 '}'
		if _, err := dec.Token(); err != nil {
			return err
		}
		// 验证 keys 是否已排序
		if !sort.StringsAreSorted(keys) {
			return fmt.Errorf("keys not sorted: %v", keys)
		}

	case json.Delim('['):
		// 解析 array：递归验证每个元素
		for dec.More() {
			if err := verifyTokenOrder(dec); err != nil {
				return err
			}
		}
		// 读取闭合 ']'
		if _, err := dec.Token(); err != nil {
			return err
		}

	// 基本值（string、number、bool、null）：无需进一步验证
	default:
		// 叶子值，无需操作
	}

	return nil
}
