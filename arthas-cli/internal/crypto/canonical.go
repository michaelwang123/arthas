// canonical.go 实现 Canonical JSON 序列化，确保跨客户端产生相同的 Signable_Bytes。
//
// 本文件是 Arthas 消息签名系统的基础组件。Ed25519 签名要求签名方和验证方
// 对完全相同的字节序列进行操作。Canonical JSON 通过递归排序 object keys，
// 保证无论字段插入顺序如何，序列化结果始终一致。
//
// 与 Web 客户端的 src/crypto/canonicalJson.ts 产生完全相同的字节输出，
// 这是跨客户端签名互操作的前提条件。
//
// 📚 学习要点: 为什么不能使用 json.Marshal？
// Go 的 json.Marshal 对 struct 按字段声明顺序输出（不是字母序），
// 对 map[string]interface{} 虽然会排序 keys，但嵌套 struct 仍按声明序。
// 更重要的是，我们需要与 Web 客户端的递归实现产生完全相同的输出，
// 包括数字格式（整数无小数点）、字符串转义等细节。
// 因此必须使用 map[string]interface{} + 手动排序 keys 的递归实现，
// 完全控制输出格式。
package crypto

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// CanonicalJSON 将任意值序列化为 canonical JSON 字节切片（递归实现）。
//
// 序列化规则：
//   - object (map[string]interface{}): key 按 Unicode 字母序排列，递归处理嵌套对象
//   - array ([]interface{}): 元素保持原始顺序，每个元素递归序列化
//   - string: 使用 strconv.Quote 进行 JSON 转义（与 JSON 规范一致）
//   - number (float64/int/int64 等): 整数输出无小数点，浮点数保留小数
//   - bool: "true" 或 "false"
//   - nil: "null"
//   - 无缩进、无尾部换行、无 BOM
//
// 与 Web 客户端的 canonicalJsonStringify 产生完全相同的字节输出。
//
// 参数:
//   - value: 待序列化的值（通常是 map[string]interface{} 或基本类型）
//
// 返回:
//   - []byte: canonical JSON 的 UTF-8 字节
//   - error: 遇到不支持的类型时返回错误
//
// 📚 学习要点: 递归下降序列化
// 这是一种经典的递归下降（recursive descent）模式：
// 根据值的动态类型分派到不同的序列化逻辑。
// 与编译器中的递归下降解析器类似，每种类型对应一个处理分支。
// 这种模式的优点是代码结构清晰，每种类型的序列化规则一目了然。
func CanonicalJSON(value interface{}) ([]byte, error) {
	var buf strings.Builder
	if err := canonicalWrite(&buf, value); err != nil {
		return nil, err
	}
	return []byte(buf.String()), nil
}

// canonicalWrite 递归地将值写入 strings.Builder。
// 内部函数，处理所有 JSON 值类型的序列化。
func canonicalWrite(buf *strings.Builder, value interface{}) error {
	switch v := value.(type) {
	case nil:
		buf.WriteString("null")

	case bool:
		if v {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}

	case string:
		// 📚 学习要点: strconv.Quote 与 JSON 字符串转义
		// strconv.Quote 产生 Go 字符串字面量格式，恰好与 JSON 字符串转义规则一致：
		// - 双引号包围
		// - 反斜杠转义特殊字符（\n, \t, \", \\）
		// - 非 ASCII 字符保持 UTF-8 原样（不转义为 \uXXXX）
		// 这与 JavaScript 的 JSON.stringify 对字符串的处理一致。
		buf.WriteString(strconv.Quote(v))

	case float64:
		// 📚 学习要点: JavaScript 的 Number 类型
		// JavaScript 中所有数字都是 float64（IEEE 754 双精度）。
		// JSON 解码到 map[string]interface{} 时，Go 默认将数字解码为 float64。
		// 为了与 Web 客户端输出一致：
		// - 整数值（如 42.0）输出为 "42"（无小数点）
		// - 非整数值（如 3.14）输出为 "3.14"
		if v == float64(int64(v)) {
			buf.WriteString(strconv.FormatInt(int64(v), 10))
		} else {
			buf.WriteString(strconv.FormatFloat(v, 'f', -1, 64))
		}

	// 处理 msgpack 解码可能产生的各种整数类型
	// 📚 学习要点: msgpack 类型断言陷阱
	// vmihailenco/msgpack/v5 将小正整数解码为 int8/uint8，
	// 而非统一的 int64/uint64。因此需要处理所有可能的整数类型。
	case int:
		buf.WriteString(strconv.FormatInt(int64(v), 10))
	case int8:
		buf.WriteString(strconv.FormatInt(int64(v), 10))
	case int16:
		buf.WriteString(strconv.FormatInt(int64(v), 10))
	case int32:
		buf.WriteString(strconv.FormatInt(int64(v), 10))
	case int64:
		buf.WriteString(strconv.FormatInt(v, 10))
	case uint:
		buf.WriteString(strconv.FormatUint(uint64(v), 10))
	case uint8:
		buf.WriteString(strconv.FormatUint(uint64(v), 10))
	case uint16:
		buf.WriteString(strconv.FormatUint(uint64(v), 10))
	case uint32:
		buf.WriteString(strconv.FormatUint(uint64(v), 10))
	case uint64:
		buf.WriteString(strconv.FormatUint(v, 10))

	case map[string]interface{}:
		// 📚 学习要点: Canonical JSON 的核心 — 递归排序 keys
		// 每层 object 的 keys 按 Unicode 字母序（sort.Strings 使用 UTF-8 字节序）排列。
		// 嵌套的 map 在递归调用时同样会被排序，确保任意深度的对象都有确定性输出。
		// 这是跨客户端签名互操作的关键：无论字段插入顺序如何，输出始终一致。
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)

		buf.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			// key 始终是字符串，使用 strconv.Quote 转义
			buf.WriteString(strconv.Quote(k))
			buf.WriteByte(':')
			// 递归序列化 value
			if err := canonicalWrite(buf, v[k]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')

	case []interface{}:
		// 数组元素保持原始顺序（不排序），每个元素递归序列化
		buf.WriteByte('[')
		for i, elem := range v {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := canonicalWrite(buf, elem); err != nil {
				return err
			}
		}
		buf.WriteByte(']')

	default:
		return fmt.Errorf("crypto/canonical: unsupported type %T", value)
	}

	return nil
}

// ComputeSignableBytes 从 payload map 中移除 "sig" 字段，
// 然后调用 CanonicalJSON 序列化为 UTF-8 字节。
//
// 这是 Ed25519 签名流程的关键步骤：
//  1. 发送方构建 payload（不含 sig）
//  2. 调用 ComputeSignableBytes 得到确定性字节序列
//  3. 对字节序列进行 Ed25519 签名
//  4. 将签名插入 payload 的 sig 字段
//
// 接收方验证时：
//  1. 从收到的 payload 中提取 sig
//  2. 调用 ComputeSignableBytes（自动移除 sig）得到相同的字节序列
//  3. 用发送方公钥验证签名
//
// 参数:
//   - payload: 消息载荷 map（可能包含 "sig" 字段，会被移除后序列化）
//
// 返回:
//   - []byte: 用于签名/验证的 UTF-8 字节序列
//   - error: 序列化错误
//
// 📚 学习要点: 为什么移除 sig 字段？
// 签名覆盖的是"被签名的内容"，而非签名本身。如果 sig 字段参与签名计算，
// 就会产生循环依赖（签名依赖自身的值）。因此签名计算时必须排除 sig 字段，
// 这与 JWT（JSON Web Token）的签名机制类似。
func ComputeSignableBytes(payload map[string]interface{}) ([]byte, error) {
	// 创建副本，避免修改调用方的原始 map
	clean := make(map[string]interface{}, len(payload))
	for k, v := range payload {
		if k == "sig" {
			continue // 跳过 sig 字段
		}
		clean[k] = v
	}

	return CanonicalJSON(clean)
}

// ──────────────────────────────────────────────────────────────────────────────
// Test Vectors（跨客户端验证基准）
// ──────────────────────────────────────────────────────────────────────────────
//
// 以下 Test Vectors 与 Web 客户端 (src/crypto/canonicalJson.ts) 共享，
// 用于验证两端实现产生完全相同的字节输出。
//
// Test Vector 1 (纯文本):
//   Input:  {"text": "Hello"}
//   Signable JSON: {"text":"Hello"}
//   Signable Bytes (hex): 7b2274657874223a2248656c6c6f227d
//
// Test Vector 2 (带 reply — 验证嵌套对象递归排序):
//   Input:  {"reply": {"preview": "Hi", "senderName": "A", "stableId": "x:1"}, "text": "World"}
//   Signable JSON: {"reply":{"preview":"Hi","senderName":"A","stableId":"x:1"},"text":"World"}
//   Signable Bytes (hex): 7b227265706c79223a7b2270726576696577223a224869222c2273656e6465724e616d65223a2241222c22737461626c654964223a22783a31227d2c2274657874223a22576f726c64227d
//
// Test Vector 3 (pubkey announcement):
//   Input:  {"pubkey": "dGVzdC1wdWJsaWMta2V5LWJhc2U2NHVybA", "text": "", "type": "pubkey"}
//   Signable JSON: {"pubkey":"dGVzdC1wdWJsaWMta2V5LWJhc2U2NHVybA","text":"","type":"pubkey"}
//   Signable Bytes (hex): 7b227075626b6579223a226447567a6443317764574a7361574d74613256354c574a68633255324e4856796241222c2274657874223a22222c2274797065223a227075626b6579227d
// ──────────────────────────────────────────────────────────────────────────────
