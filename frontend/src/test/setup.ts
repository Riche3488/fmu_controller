import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// Mantine 색 스킴이 localStorage에 남아 다음 테스트에 새지 않게
afterEach(() => localStorage.clear());

// Mantine이 요구하는 브라우저 API (jsdom 미구현)
// 일반 함수로 정의: vi.restoreAllMocks()가 구현을 지우지 않도록
const noop = () => {};
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop,
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

window.HTMLElement.prototype.scrollIntoView = noop;

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
