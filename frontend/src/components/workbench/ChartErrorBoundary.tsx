// 패널 하나의 차트 렌더 오류가 앱 전체를 하얗게 만들지 않도록 막는다. resetKey가 바뀌면 다시 그려 본다.
import { Center, Text } from '@mantine/core';
import { Component, type ReactNode } from 'react';

type Props = { resetKey: unknown; children: ReactNode };
type State = { error: Error | null; key: unknown };

export class ChartErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  render() {
    if (this.state.error) {
      return (
        <Center h="100%">
          <Text size="sm" c="red" data-testid="panel-error">차트 오류: {this.state.error.message}</Text>
        </Center>
      );
    }
    return this.props.children;
  }
}
