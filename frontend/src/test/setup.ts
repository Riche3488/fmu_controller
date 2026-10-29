import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mantine이 요구하는 브라우저 API (jsdom 미구현)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

window.HTMLElement.prototype.scrollIntoView = vi.fn();

// ECharts는 canvas가 필요하므로 테스트에서는 option을 data 속성으로 노출하는 stub으로 대체
vi.mock('echarts-for-react', async () => {
  const React = await import('react');
  return {
    default: ({ option, onEvents, ...rest }: { option: unknown; onEvents?: Record<string, (p: unknown) => void>; 'data-testid'?: string }) =>
      React.createElement('div', {
        'data-testid': rest['data-testid'] ?? 'echarts',
        'data-option': JSON.stringify(option),
        onClick: (e: { target: { dataset?: { pointId?: string } } }) => {
          const id = e.target.dataset?.pointId;
          if (id && onEvents?.click) onEvents.click({ data: { id } });
        },
      }),
  };
});
