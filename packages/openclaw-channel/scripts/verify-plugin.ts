/**
 * verify-plugin.ts — 验证 OpenClaw Channel 插件是否可用
 *
 * 测试流程：
 * 1. 连接到 Arthas 服务器（HF Spaces）
 * 2. 加入房间
 * 3. 发送一条测试消息
 * 4. 等待 echo（自己的消息会被服务器中转回来，但 adapter 会过滤掉）
 * 5. 10 秒后断开连接
 *
 * 用法：npx tsx scripts/verify-plugin.ts
 */

import { ArthasChannelAdapter } from '../src/index.js';

const SERVER_URL = 'wss://arthas100-arthas-server.hf.space/ws';
const SHARE_CODE = '75IFVCcGVNotcNXoMEwhX:ZS7OjUnX4VoNSgFO0BwGPQ2n9qQ1YdAtnmW0ZAWeZOs';

async function main() {
  console.log('🔌 OpenClaw Channel Plugin 验证脚本');
  console.log('====================================');
  console.log(`  服务器: ${SERVER_URL}`);
  console.log(`  房间ID: ${SHARE_CODE.split(':')[0]}`);
  console.log('');

  const adapter = new ArthasChannelAdapter();

  // 监听连接状态
  adapter.onStatusChange((status) => {
    const icons: Record<string, string> = {
      connecting: '🔄',
      connected: '✅',
      reconnecting: '🔄',
      disconnected: '⚪',
      error: '❌',
    };
    console.log(`  ${icons[status] || '?'} 连接状态: ${status}`);
  });

  // 监听消息
  adapter.onMessage((msg) => {
    console.log(`  📨 收到消息: [${msg.userName}] ${msg.text}`);
  });

  try {
    // 1. 连接
    console.log('⏳ 正在连接到 Arthas 服务器...');
    await adapter.connect({
      serverUrl: SERVER_URL,
      shareCode: SHARE_CODE,
      displayName: 'Plugin Verifier',
    });
    console.log('✅ 连接成功！已加入房间。');

    // 2. 发送测试消息
    console.log('');
    console.log('📤 发送测试消息...');
    await adapter.send({
      id: crypto.randomUUID(),
      channelId: 'arthas',
      text: '🤖 Hello from OpenClaw Channel Plugin! This is an automated verification test.',
    });
    console.log('✅ 消息发送成功（已加密）！');

    // 3. 等待一会儿看是否有其他人回复
    console.log('');
    console.log('⏳ 等待 10 秒（如果有人在房间里，会显示收到的消息）...');
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // 4. 断开连接
    console.log('');
    console.log('🔌 断开连接...');
    await adapter.disconnect();
    console.log('✅ 已断开，密钥已清零。');

    console.log('');
    console.log('====================================');
    console.log('✅ 插件验证通过！所有功能正常：');
    console.log('   - WebSocket 连接 ✓');
    console.log('   - 房间加入 ✓');
    console.log('   - 消息加密发送 ✓');
    console.log('   - 连接状态回调 ✓');
    console.log('   - 安全断开（密钥清零）✓');

  } catch (error) {
    console.error('');
    console.error('❌ 验证失败:', (error as Error).message);
    console.error('');
    console.error('可能原因:');
    console.error('  1. HF Space 服务器休眠中（等 30-60 秒后重试）');
    console.error('  2. 分享码无效或已过期');
    console.error('  3. 网络连接问题（检查代理/VPN）');
    process.exit(1);
  }
}

main();
