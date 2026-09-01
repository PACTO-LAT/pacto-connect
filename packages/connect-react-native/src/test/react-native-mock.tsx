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

type AppStateStatus = 'active' | 'background' | 'inactive';
type AppStateListener = (state: AppStateStatus) => void;

const appStateListeners = new Set<AppStateListener>();

export const AppState = {
  currentState: 'active' as AppStateStatus,
  addEventListener(event: 'change', handler: AppStateListener) {
    if (event === 'change') {
      appStateListeners.add(handler);
    }
    return { remove: () => appStateListeners.delete(handler) };
  },
  // Test helpers, not part of the real API.
  __emit(state: AppStateStatus) {
    this.currentState = state;
    for (const listener of appStateListeners) {
      listener(state);
    }
  },
  __reset() {
    appStateListeners.clear();
    this.currentState = 'active';
  },
};

export const Platform = { OS: 'ios' as const };

export const StyleSheet = { create: <T,>(styles: T): T => styles };

/**
 * Test-only stand-in for `AccessibilityInfo.announceForAccessibility`, which
 * has no DOM equivalent to assert against. Tests read `__announcements`
 * instead of mocking the real native module.
 */
export const AccessibilityInfo = {
  announceForAccessibility(announcement: string): void {
    AccessibilityInfo.__announcements.push(announcement);
  },
  __announcements: [] as string[],
  __reset(): void {
    AccessibilityInfo.__announcements = [];
  },
};

function passthrough(tag: string) {
  return forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    const {
      children,
      accessibilityLabel,
      accessibilityRole,
      accessibilityHint,
      accessibilityViewIsModal,
      accessibilityLiveRegion,
      accessible,
      onPress,
      ...rest
    } = props;
    return (
      <div
        ref={ref as never}
        data-rn-component={tag}
        aria-label={accessibilityLabel as string | undefined}
        aria-hidden={accessible === false ? true : undefined}
        aria-live={accessibilityLiveRegion as 'off' | 'assertive' | 'polite' | undefined}
        role={accessibilityRole as string | undefined}
        title={accessibilityHint as string | undefined}
        data-accessibility-view-is-modal={accessibilityViewIsModal ? 'true' : undefined}
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
