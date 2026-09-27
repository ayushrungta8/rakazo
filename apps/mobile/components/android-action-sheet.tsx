import { useSyncExternalStore } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  dismissAndroidActionSheet,
  getAndroidActionSheet,
  subscribeAndroidActionSheet,
} from "../lib/message-action-sheet";
import { useMobileTokens } from "../lib/native";
import { NativeSymbol } from "./native-symbol";

/** One list for Android actions and choices, with dismissal outside the scrolling content. */
export function AndroidActionSheetHost() {
  const sheet = useSyncExternalStore(subscribeAndroidActionSheet, getAndroidActionSheet);
  const tokens = useMobileTokens();
  const insets = useSafeAreaInsets();
  if (Platform.OS === "ios" || !sheet) return null;

  return (
    <Modal transparent animationType="fade" onRequestClose={dismissAndroidActionSheet}>
      <View
        style={[styles.overlay, { backgroundColor: tokens.overlay, paddingTop: insets.top + 16 }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sheet.cancel}
          style={StyleSheet.absoluteFill}
          onPress={dismissAndroidActionSheet}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: tokens.popover,
              paddingBottom: Math.max(insets.bottom, 8),
              paddingLeft: insets.left,
              paddingRight: insets.right,
            },
          ]}
        >
          {sheet.title ? (
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: tokens.popoverForeground }]}
            >
              {sheet.title}
            </Text>
          ) : null}
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {sheet.actions.map((action, index) => (
              <Pressable
                key={index}
                accessibilityRole="button"
                accessibilityState={{ selected: action.selected }}
                style={({ pressed }) => [
                  styles.action,
                  pressed && { backgroundColor: tokens.accent },
                ]}
                onPress={() => {
                  dismissAndroidActionSheet();
                  action.onPress();
                }}
              >
                <Text style={[styles.label, { color: tokens.popoverForeground }]}>
                  {action.text}
                </Text>
                {action.selected ? (
                  <NativeSymbol ios="checkmark" android="checkmark" size={20} />
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={dismissAndroidActionSheet}
            style={({ pressed }) => [
              styles.cancel,
              { borderTopColor: tokens.border },
              pressed && { backgroundColor: tokens.accent },
            ]}
          >
            <Text style={[styles.cancelLabel, { color: tokens.popoverForeground }]}>
              {sheet.cancel}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "85%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
  },
  list: { flexGrow: 0, flexShrink: 1 },
  action: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  label: { flex: 1, fontSize: 16 },
  cancel: {
    minHeight: 56,
    justifyContent: "center",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  cancelLabel: { fontSize: 16, fontWeight: "600" },
});
