const store = new Map<string, string>();

export const ACCESSIBLE = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly',
};

export async function getGenericPassword(options: {
  service: string;
}): Promise<false | { username: string; password: string }> {
  const password = store.get(options.service);
  if (!password) {
    return false;
  }
  return { username: options.service, password };
}

export async function setGenericPassword(
  username: string,
  password: string,
  options: { service: string },
): Promise<void> {
  store.set(options.service, password);
}

export async function resetGenericPassword(options: { service: string }): Promise<boolean> {
  store.delete(options.service);
  return true;
}

export function __reset(): void {
  store.clear();
}
