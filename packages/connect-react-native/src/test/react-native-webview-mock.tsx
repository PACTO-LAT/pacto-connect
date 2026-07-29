import { forwardRef, useImperativeHandle, useRef } from 'react';

/**
 * Minimal stand-in for `react-native-webview`'s default export. Exposes just
 * enough of the imperative handle (`injectJavaScript`) for tests to drive the
 * bridge without a real native WebView. The `onMessage` /
 * `onShouldStartLoadWithRequest` props aren't real DOM events, so they're
 * stashed on the rendered node as `__testHandlers` for tests to call directly
 * rather than relying on React's synthetic DOM event system to route them.
 */

export interface WebViewMessageEvent {
  nativeEvent: { data: string; url: string };
}

export interface WebViewNavigation {
  url: string;
}

export interface WebViewRef {
  injectJavaScript(script: string): void;
  __injectedScripts: string[];
}

interface Props {
  source: { uri: string };
  onMessage?: (event: WebViewMessageEvent) => void;
  onShouldStartLoadWithRequest?: (request: WebViewNavigation) => boolean;
  injectedJavaScriptBeforeContentLoaded?: string;
  style?: unknown;
  startInLoadingState?: boolean;
}

export interface TestHandlers {
  onMessage?: Props['onMessage'];
  onShouldStartLoadWithRequest?: Props['onShouldStartLoadWithRequest'];
}

const WebView = forwardRef<WebViewRef, Props>((props, ref) => {
  const injected = useRef<string[]>([]);

  useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => {
      injected.current.push(script);
    },
    get __injectedScripts() {
      return injected.current;
    },
  }));

  return (
    <div
      data-rn-component="WebView"
      data-uri={props.source.uri}
      data-injected-before-load={props.injectedJavaScriptBeforeContentLoaded}
      ref={(node) => {
        if (node) {
          (node as unknown as { __testHandlers: TestHandlers }).__testHandlers = {
            onMessage: props.onMessage,
            onShouldStartLoadWithRequest: props.onShouldStartLoadWithRequest,
          };
        }
      }}
    />
  );
});

export default WebView;
