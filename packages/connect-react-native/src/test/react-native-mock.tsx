import { forwardRef } from 'react';

/**
 * Minimal stand-in for the subset of `react-native` this package touches.
 * The real package requires a native runtime and can't run under Vitest/jsdom;
 * consumers still get the real module's types at build time via the peer +
 * devDependency entries in package.json.
 */

type UrlListener = (event: { url: string }) => void;

const urlListeners = new Set<UrlListener>();
let initialUrl: string | null = null;

export const Linking = {
  addEventListener(event: 'url', handler: UrlListener) {
    if (event === 'url') {
      urlListeners.add(handler);
    }
    return { remove: () => urlListeners.delete(handler) };
  },
  getInitialURL: () => Promise.resolve(initialUrl),
  openURL: (_url: string) => Promise.resolve(true),
  // Test helpers, not part of the real API.
  __emit(url: string) {
    for (const listener of urlListeners) {
      listener({ url });
    }
  },
  __setInitialURL(url: string | null) {
    initialUrl = url;
  },
  __reset() {
    urlListeners.clear();
    initialUrl = null;
  },
};

export const Platform = { OS: 'ios' as const };

export const StyleSheet = { create: <T,>(styles: T): T => styles };

function passthrough(tag: string) {
  return forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    const { children, accessibilityLabel, accessibilityRole, onPress, ...rest } = props;
    return (
      <div
        ref={ref as never}
        data-rn-component={tag}
        aria-label={accessibilityLabel as string | undefined}
        role={accessibilityRole as string | undefined}
        onClick={onPress as never}
        {...rest}
      >
        {children as never}
      </div>
    );
  });
}

export const View = passthrough('View');
export const Text = passthrough('Text');
export const Pressable = passthrough('Pressable');
export const SafeAreaView = passthrough('SafeAreaView');

export const Modal = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
  const { visible, children, animationType, presentationStyle, onRequestClose, ...rest } =
    props as {
      visible?: boolean;
      children?: unknown;
      animationType?: unknown;
      presentationStyle?: unknown;
      onRequestClose?: unknown;
    };
  if (!visible) {
    return null;
  }
  return (
    <div ref={ref as never} data-rn-component="Modal" {...rest}>
      {children as never}
    </div>
  );
});
