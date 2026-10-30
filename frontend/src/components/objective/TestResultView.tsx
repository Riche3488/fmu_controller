// 목적함수 테스트 실행 결과 (값·오류·stdout). 목적함수 편집 화면과 설계기 코드 모드가 같이 쓴다.
import { Alert, Card, Code, Text } from '@mantine/core';
import type { ObjectiveTestResult } from '../../api/types';

export function TestResultView({ result }: { result: ObjectiveTestResult }) {
  return (
    <>
      {result.error ? (
        <Alert color="red" title="오류"><Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap' }}>{result.error}</Text></Alert>
      ) : (
        <Card withBorder>
          <Text size="xs" c="dimmed">값 ({result.durationMs} ms)</Text>
          <Text fw={700} size="lg" className="fmuc-num" data-testid="test-value">{result.value === null ? 'null' : result.value}</Text>
        </Card>
      )}
      {result.stdout && (
        <div>
          <Text size="xs" c="dimmed">stdout</Text>
          <Code block>{result.stdout}</Code>
        </div>
      )}
    </>
  );
}
