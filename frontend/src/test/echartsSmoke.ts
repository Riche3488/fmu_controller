// 차트 옵션을 실제 ECharts에 넣어 보는 헤드리스 스모크 검사. 옵션 객체만 보는 테스트가 못 잡는 ECharts 내부 검증 오류를 잡는다.
import * as echarts from 'echarts';

// jsdom에는 canvas가 없어 글자 폭 측정이 오류를 로그로 남기므로 근사값으로 대신한다
echarts.setPlatformAPI({ measureText: (text, font) => ({ width: String(text).length * (parseInt(String(font).match(/(\d+)px/)?.[1] ?? '12', 10) * 0.6) }) });

/** SVG SSR 렌더로 setOption + 한 번 그려 본다. 오류가 나면 throw. 3D(echarts-gl) 옵션은 WebGL이 없어 쓰지 않는다. */
export function smokeRender(option: unknown): string {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
  try {
    chart.setOption(option as echarts.EChartsOption);
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}
