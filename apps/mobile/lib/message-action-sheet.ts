import { ActionSheetIOS, Platform } from "react-native";

export type MessageAction = { text: string; onPress: () => void; selected?: boolean };
export type AndroidActionSheet = { actions: MessageAction[]; title?: string; cancel: string };

let currentSheet: AndroidActionSheet | null = null;
const listeners = new Set<() => void>();

export function getAndroidActionSheet(): AndroidActionSheet | null {
  return currentSheet;
}

export function subscribeAndroidActionSheet(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissAndroidActionSheet(): void {
  currentSheet = null;
  for (const listener of listeners) listener();
}

export function presentMessageActionSheet({
  actions,
  title,
  cancel,
  colorScheme,
}: {
  actions: MessageAction[];
  title?: string;
  cancel: string;
  colorScheme: "light" | "dark";
}): void {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((action) => action.text), cancel],
        cancelButtonIndex: actions.length,
        title,
        userInterfaceStyle: colorScheme,
      },
      (index) => actions[index]?.onPress(),
    );
    return;
  }

  currentSheet = { actions, title, cancel };
  for (const listener of listeners) listener();
}
