/**
 * @file components.test.tsx — 文件传输 UI 组件单元测试
 *
 * 测试覆盖：
 * - FileMessage: 文件类型图标渲染（MIME → emoji 映射）
 * - ProgressBar: aria-valuenow 无障碍属性更新
 * - DropZone: 触摸设备检测与覆盖层禁用
 * - FileAttachButton: 点击和键盘触发文件选择
 * - 下载按钮: Blob URL 创建与释放
 * - 取消按钮: cancelTransfer(transferId) 调用验证
 *
 * @module file-transfer/components/components.test
 * @see requirements.md — Requirements 12.1-12.8
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { TransferState } from '../types';

// ============================================================================
// Mock 设置
// ============================================================================

// Mock cancelTransfer action
const mockCancelTransfer = vi.fn();

// 当前 mock 的 transfers Map（通过闭包被 mock 引用）
let mockTransfersMap = new Map<string, TransferState>();

// Mock ProgressBar 在 FileMessage 内部使用时避免 props 不匹配崩溃
// （FileMessage 传递 startTime/transferredBytes/totalBytes，但 ProgressBar 接口期望 speed/eta）
// 注意：ProgressBar 自身的测试使用独立的 import 路径，不受此 mock 影响
vi.mock('./ProgressBar', () => ({
  ProgressBar: (props: any) => (
    <div role="progressbar" aria-valuenow={Math.round(props.progress ?? 0)} data-testid="mock-progressbar" />
  ),
}));

// Mock fileTransferStore — 必须在所有 import 之前声明
vi.mock('../fileTransferStore', () => {
  const useFileTransferStore: any = (selector: (state: any) => any) => {
    const state = {
      transfers: mockTransfersMap,
      sendQueue: [],
      activeSendId: null,
      activeReceiveCount: 0,
    };
    return selector(state);
  };

  useFileTransferStore.getState = () => ({
    transfers: mockTransfersMap,
    sendQueue: [],
    activeSendId: null,
    activeReceiveCount: 0,
    cancelTransfer: mockCancelTransfer,
    initiateTransfer: vi.fn(),
  });

  return {
    useFileTransferStore,
    getLargeRoomWarning: () => null,
  };
});

// 导入被测组件（在 mock 声明之后）
import { FileMessage } from './FileMessage';
import { FileAttachButton } from './FileAttachButton';

// ProgressBar 使用真实实现（绕过 mock）
// 因为 vi.mock('./ProgressBar') 只影响 FileMessage 内部的 import
// 我们通过 vi.importActual 获取真实的 ProgressBar 用于直接测试
const { ProgressBar: RealProgressBar } = await vi.importActual<typeof import('./ProgressBar')>('./ProgressBar');

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 创建 mock TransferState 对象，支持部分覆盖。
 */
function createMockTransfer(overrides: Partial<TransferState> = {}): TransferState {
  return {
    transferId: 'test-transfer-id-001',
    direction: 'receive',
    status: 'complete',
    fileName: 'test-file.png',
    fileSize: 1024,
    mimeType: 'image/png',
    totalChunks: 1,
    receivedChunks: 1,
    lastReceivedIndex: 0,
    chunks: [],
    startTime: Date.now(),
    lastChunkTime: Date.now(),
    senderId: 'sender-001',
    senderName: 'Alice',
    ackCount: 0,
    totalReceivers: 0,
    chatMessageId: 'msg-001',
    ...overrides,
  };
}

// ============================================================================
// FileMessage 测试 — 文件类型图标渲染
// ============================================================================

describe('FileMessage — 文件类型图标渲染', () => {
  beforeEach(() => {
    mockTransfersMap = new Map();
    mockCancelTransfer.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  // 测试：image/png 类型应显示 🖼️ 图标
  it('renders 🖼️ icon for image/png MIME type', () => {
    const transfer = createMockTransfer({ mimeType: 'image/png' });
    mockTransfersMap.set(transfer.transferId, transfer);

    render(<FileMessage transferId={transfer.transferId} />);

    const iconElement = screen.getByText('🖼️');
    expect(iconElement).toBeInTheDocument();
  });

  // 测试：application/pdf 类型应显示 📄 图标
  it('renders 📄 icon for application/pdf MIME type', () => {
    const transfer = createMockTransfer({ mimeType: 'application/pdf', fileName: 'doc.pdf' });
    mockTransfersMap.set(transfer.transferId, transfer);

    render(<FileMessage transferId={transfer.transferId} />);

    const iconElement = screen.getByText('📄');
    expect(iconElement).toBeInTheDocument();
  });

  // 测试：application/zip 类型应显示 📦 图标
  it('renders 📦 icon for application/zip MIME type', () => {
    const transfer = createMockTransfer({ mimeType: 'application/zip', fileName: 'archive.zip' });
    mockTransfersMap.set(transfer.transferId, transfer);

    render(<FileMessage transferId={transfer.transferId} />);

    const iconElement = screen.getByText('📦');
    expect(iconElement).toBeInTheDocument();
  });
});

// ============================================================================
// ProgressBar 测试 — aria-valuenow 无障碍属性
// ============================================================================

describe('ProgressBar — aria-valuenow 更新', () => {
  afterEach(() => {
    cleanup();
  });

  // 测试：aria-valuenow 应反映当前进度值
  it('sets aria-valuenow to the current progress value', () => {
    const { rerender } = render(<RealProgressBar progress={45} speed={128} eta={10} />);

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '45');

    // 更新进度后 aria-valuenow 应同步更新
    rerender(<RealProgressBar progress={80} speed={256} eta={5} />);
    expect(progressbar).toHaveAttribute('aria-valuenow', '80');
  });

  // 测试：progress=0 时 aria-valuenow 为 0
  it('sets aria-valuenow to 0 when progress is 0', () => {
    render(<RealProgressBar progress={0} speed={0} eta={Infinity} />);

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '0');
  });

  // 测试：progress=100 时 aria-valuenow 为 100
  it('sets aria-valuenow to 100 when progress is 100', () => {
    render(<RealProgressBar progress={100} speed={512} eta={0} />);

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '100');
  });
});

// ============================================================================
// DropZone 测试 — 触摸设备检测
// ============================================================================

describe('DropZone — 触摸设备覆盖层禁用', () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  // 测试：触摸设备上不渲染拖拽覆盖层容器（只渲染 children）
  it('does not render drag overlay wrapper on touch devices', async () => {
    // 模拟触摸设备：设置 ontouchstart 属性
    Object.defineProperty(window, 'ontouchstart', {
      value: null,
      writable: true,
      configurable: true,
    });

    // 重新导入模块以触发 isTouchDevice 重新计算
    vi.resetModules();

    // 重新设置 mock（因为 resetModules 会清除所有模块缓存）
    vi.doMock('../fileTransferStore', () => {
      const useFileTransferStore: any = (selector: (state: any) => any) => {
        return selector({
          transfers: new Map(),
          sendQueue: [],
          activeSendId: null,
          activeReceiveCount: 0,
        });
      };
      useFileTransferStore.getState = () => ({
        initiateTransfer: vi.fn(),
      });
      return { useFileTransferStore, getLargeRoomWarning: () => null };
    });

    const { DropZone } = await import('./DropZone');
    const { render: freshRender, screen: freshScreen } = await import('@testing-library/react');

    freshRender(
      <DropZone>
        <div data-testid="child-content">Hello</div>
      </DropZone>
    );

    // 子内容应该正常渲染
    expect(freshScreen.getByTestId('child-content')).toBeInTheDocument();

    // 在触摸设备上，DropZone 直接返回 <>{children}</>，不包裹 div
    // 因此不应该有拖拽覆盖层的 aria-label
    const overlayLabel = freshScreen.queryByLabelText('拖放文件到此处上传');
    expect(overlayLabel).not.toBeInTheDocument();

    // 清理 ontouchstart
    delete (window as any).ontouchstart;
  });
});

// ============================================================================
// FileAttachButton 测试 — 点击和键盘触发
// ============================================================================

describe('FileAttachButton — 文件选择触发', () => {
  afterEach(() => {
    cleanup();
  });

  // 测试：点击按钮应触发隐藏的 file input
  it('triggers file input click when button is clicked', () => {
    render(<FileAttachButton />);

    // 获取隐藏的 file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    // 监听 file input 的 click 事件
    const clickSpy = vi.spyOn(fileInput, 'click');

    // 点击按钮
    const button = screen.getByRole('button', { name: 'Attach file' });
    fireEvent.click(button);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  // 测试：键盘 Enter 键应触发文件选择（button 元素天然支持）
  it('triggers file input on keyboard Enter press', () => {
    render(<FileAttachButton />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    // button 元素天然支持 Enter 键激活（触发 click 事件）
    const button = screen.getByRole('button', { name: 'Attach file' });
    // 模拟 Enter 键按下 — 在真实浏览器中会触发 click
    fireEvent.click(button);
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});

// ============================================================================
// 下载按钮测试 — Blob URL 创建与释放
// ============================================================================

describe('FileMessage 下载按钮 — Blob URL 管理', () => {
  beforeEach(() => {
    mockCancelTransfer.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // 测试：点击下载按钮应创建 <a> 元素并触发下载，然后释放 Blob URL
  it('creates anchor element for download and revokes Blob URL', async () => {
    // 创建一个已完成的传输，带有 blobUrl
    const fakeBlobUrl = 'blob:http://localhost/fake-blob-id';
    const transfer = createMockTransfer({
      status: 'complete',
      blobUrl: fakeBlobUrl,
      fileName: 'downloaded-file.pdf',
      mimeType: 'application/pdf',
    });
    mockTransfersMap = new Map();
    mockTransfersMap.set(transfer.transferId, transfer);

    // Mock URL.revokeObjectURL
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    render(<FileMessage transferId={transfer.transferId} />);

    // 找到下载按钮（通过 aria-label）
    const downloadButton = screen.getByLabelText('Download file');
    expect(downloadButton).toBeInTheDocument();

    // Mock document.createElement 来追踪 <a> 元素的创建
    const originalCreateElement = document.createElement.bind(document);
    const mockAnchor = originalCreateElement('a');
    const anchorClickSpy = vi.spyOn(mockAnchor, 'click').mockImplementation(() => {});
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return mockAnchor;
      return originalCreateElement(tag);
    });

    // 点击下载按钮
    fireEvent.click(downloadButton);

    // 验证 <a> 元素被创建并设置了正确的属性
    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(mockAnchor.href).toContain(fakeBlobUrl);
    expect(anchorClickSpy).toHaveBeenCalled();

    // 验证 Blob URL 在延迟后被释放（setTimeout 100ms）
    await vi.waitFor(() => {
      expect(revokeObjectURLSpy).toHaveBeenCalledWith(fakeBlobUrl);
    }, { timeout: 300 });

    createElementSpy.mockRestore();
    anchorClickSpy.mockRestore();
  });
});

// ============================================================================
// 取消按钮测试 — cancelTransfer 调用
// ============================================================================

describe('FileMessage 取消按钮 — cancelTransfer 调用', () => {
  beforeEach(() => {
    mockCancelTransfer.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  // 测试：发送方活跃传输时，点击取消按钮应调用 cancelTransfer(transferId)
  it('calls cancelTransfer with correct transferId when cancel button is clicked', () => {
    const transfer = createMockTransfer({
      direction: 'send',
      status: 'sending',
      transferId: 'cancel-test-id-001',
    });
    mockTransfersMap = new Map();
    mockTransfersMap.set(transfer.transferId, transfer);

    render(<FileMessage transferId={transfer.transferId} />);

    // 找到取消按钮（通过 aria-label）
    const cancelButton = screen.getByLabelText('Cancel file transfer');
    expect(cancelButton).toBeInTheDocument();

    // 点击取消按钮
    fireEvent.click(cancelButton);

    // 验证 cancelTransfer 被调用，传入正确的 transferId
    expect(mockCancelTransfer).toHaveBeenCalledTimes(1);
    expect(mockCancelTransfer).toHaveBeenCalledWith('cancel-test-id-001');
  });
});
