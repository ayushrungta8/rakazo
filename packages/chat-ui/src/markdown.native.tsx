import { type ColorTokens, darkTokens, type ResolvedAppearance } from "@rakazo/ui-tokens";
import type { ASTNode } from "@ronradtke/react-native-markdown-display";
import Markdown, {
  createMarkdownIt,
  MarkdownStream,
  type RenderRules,
} from "@ronradtke/react-native-markdown-display";
import type { ReactNode } from "react";
import { createContext, memo, useContext, useMemo, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Linking, Platform, type ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import type { ChatMarkdownProps } from "./markdown";
import { linkifyExplicitUrls, sanitizeMarkdownUrl } from "./markdown";

// One shared parser: the Markdown components memoize on its identity.
const markdownParser = linkifyExplicitUrls(createMarkdownIt());

function markdownStyles(palette: ColorTokens) {
  return StyleSheet.create({
    body: {
      color: palette.foreground,
      fontSize: 15.5,
      lineHeight: 23,
      width: "100%",
      minWidth: 0,
      flexShrink: 1,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 9,
      width: "100%",
      flexShrink: 1,
    },
    heading1: {
      color: palette.foreground,
      fontSize: 21,
      lineHeight: 27,
      marginTop: 10,
      marginBottom: 5,
    },
    heading2: {
      color: palette.foreground,
      fontSize: 19,
      lineHeight: 25,
      marginTop: 10,
      marginBottom: 5,
    },
    heading3: {
      color: palette.foreground,
      fontSize: 17,
      lineHeight: 23,
      marginTop: 8,
      marginBottom: 4,
    },
    strong: {
      color: palette.foreground,
      fontWeight: "700",
    },
    link: {
      color: palette.link,
      textDecorationLine: "underline",
      marginBottom: 0,
    },
    code_inline: {
      color: palette.foreground,
      backgroundColor: palette.background,
      borderColor: palette.border,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 0,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 4,
    },
    code_block: {
      color: palette.foreground,
      backgroundColor: palette.background,
      borderColor: palette.border,
    },
    fence: {
      backgroundColor: palette.background,
      borderColor: palette.border,
    },
    fence_code: {
      backgroundColor: palette.background,
    },
    blockquote: {
      backgroundColor: "transparent",
      borderLeftColor: palette.border,
    },
    table: {
      borderColor: palette.border,
    },
    th: {
      minWidth: 0,
      flexShrink: 1,
      padding: 10,
    },
    td: {
      minWidth: 0,
      flexShrink: 1,
      padding: 10,
    },
    tr: {
      borderColor: palette.border,
    },
    hr: {
      backgroundColor: palette.border,
    },
    bullet_list_content: {
      flex: 1,
      flexShrink: 1,
      minWidth: 0,
    },
    ordered_list_content: {
      flex: 1,
      flexShrink: 1,
      minWidth: 0,
    },
  });
}

async function openSafeLink(url: string) {
  const safeUrl = sanitizeMarkdownUrl(url);
  if (!safeUrl) return;
  if (await Linking.canOpenURL(safeUrl)) await Linking.openURL(safeUrl);
}

// Constrain the viewport independently of the table. A minimum row width alone
// lets long cell text grow the viewport itself, clipping columns without overflow.
const TABLE_MIN_COLUMN_WIDTH = 160;

// The chat must wait for the table to classify the drag before scrolling.
export const ChatScrollGestureContext = createContext<ReturnType<typeof Gesture.Native> | null>(
  null,
);

function tableColumnCount(node: ASTNode): number {
  return node.type === "tr"
    ? node.children.length
    : Math.max(0, ...node.children.map(tableColumnCount));
}

function TableScrollView({
  children,
  style,
  columns,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  columns: number;
}) {
  // Percentage widths do not resolve inside a horizontal ScrollView, so the
  // content floor comes from the measured viewport: narrow tables still fill
  // the bubble while wider rows grow the scrollable content.
  const [viewportWidth, setViewportWidth] = useState(0);
  const parentScroll = useContext(ChatScrollGestureContext);
  const scroll = useAnimatedRef<ScrollView>();
  const offset = useSharedValue(0);
  const startOffset = useSharedValue(0);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const direction = useSharedValue(0);
  const tableWidth = Math.max(viewportWidth, columns * TABLE_MIN_COLUMN_WIDTH);
  const maxOffset = Math.max(0, tableWidth - viewportWidth);
  const horizontalPan = useMemo(() => {
    const pan = Gesture.Pan()
      .manualActivation(true)
      .onTouchesDown((event) => {
        "worklet";
        direction.value = 0;
        touchX.value = event.allTouches[0]?.absoluteX ?? 0;
        touchY.value = event.allTouches[0]?.absoluteY ?? 0;
      })
      .onTouchesMove((event, manager) => {
        "worklet";
        if (direction.value !== 0) return;
        const touch = event.allTouches[0];
        if (!touch) return;
        const dx = Math.abs(touch.absoluteX - touchX.value);
        const dy = Math.abs(touch.absoluteY - touchY.value);
        if (Math.max(dx, dy) < 6) return;
        if (dx > dy) {
          direction.value = 1;
          manager.activate();
        } else {
          direction.value = -1;
          manager.fail();
        }
      })
      .onStart(() => {
        "worklet";
        startOffset.value = offset.value;
      })
      .onUpdate((event) => {
        "worklet";
        offset.value = Math.max(0, Math.min(maxOffset, startOffset.value - event.translationX));
        scrollTo(scroll, offset.value, 0, false);
      });
    return parentScroll ? pan.blocksExternalGesture(parentScroll) : pan;
  }, [parentScroll, direction, maxOffset, offset, scroll, startOffset, touchX, touchY]);
  const onScroll = useAnimatedScrollHandler((event) => {
    offset.value = event.contentOffset.x;
  });
  const content = (
    <Animated.ScrollView
      ref={scroll}
      horizontal
      scrollEnabled={Platform.OS !== "android"}
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      style={[style, layout.tableViewport]}
      onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      scrollEventThrottle={16}
      onScroll={onScroll}
    >
      <View style={{ width: tableWidth }}>{children}</View>
    </Animated.ScrollView>
  );
  return Platform.OS === "android" ? (
    <GestureDetector gesture={horizontalPan}>{content}</GestureDetector>
  ) : (
    content
  );
}

// Keep links as Text so they stay inside textgroup; Pressable (a View) is laid out
// outside the text flow and collapses the bubble height, overlapping later messages.
const renderRules: RenderRules = {
  table: (node, children, _parent, styleMap) => (
    <TableScrollView
      key={node.key}
      columns={tableColumnCount(node)}
      style={styleMap._VIEW_SAFE_table}
    >
      {children}
    </TableScrollView>
  ),
  tr: (node, children, _parent, styleMap) => (
    <View key={node.key} style={styleMap._VIEW_SAFE_tr}>
      {children}
    </View>
  ),
  link: (node, children, _parent, styleMap) => (
    <Text
      accessibilityRole="link"
      key={node.key}
      style={styleMap.link}
      onPress={() => {
        void openSafeLink(node.attributes.href ?? "");
      }}
    >
      {children}
    </Text>
  ),
};

export const ChatMarkdown = memo(function ChatMarkdown({
  children,
  streaming = false,
  palette = darkTokens,
  colorScheme = "dark",
}: ChatMarkdownProps & { palette?: ColorTokens; colorScheme?: ResolvedAppearance }) {
  const styles = useMemo(() => markdownStyles(palette), [palette]);
  const sharedProps = {
    colorScheme,
    markdownit: markdownParser,
    style: styles,
    rules: renderRules,
    allowedImageHandlers: ["https://", "http://"],
    onLinkPress: (url: string) => {
      void openSafeLink(url);
      return false;
    },
  };

  return (
    <View style={layout.wrap}>
      {streaming ? (
        <MarkdownStream {...sharedProps} cursorColor={palette.mutedForeground} streaming>
          {children}
        </MarkdownStream>
      ) : (
        <Markdown {...sharedProps}>{children}</Markdown>
      )}
    </View>
  );
});

const layout = StyleSheet.create({
  tableViewport: {
    width: "100%",
    minWidth: 0,
    flexShrink: 1,
    flexGrow: 0,
  },
  wrap: {
    width: "100%",
    minWidth: 0,
    flexShrink: 1,
  },
});

export type { ChatMarkdownProps } from "./markdown";
