import { useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ArrowLeft } from "lucide-react-native";
import { BackHeader } from "@/components/headers/back-header";
import { MenuHeader } from "@/components/headers/menu-header";
import { useIsCompactFormFactor } from "@/constants/layout";

interface PageLayoutProps {
  title?: string;
  /** Compact back button. Defaults to navigating back. */
  onBack?: () => void;
  testID?: string;
  titleTestID?: string;
  /** Controls for the whole page: right of the title on desktop, in the back header on compact. */
  actions?: ReactNode;
  children: ReactNode;
  /** If true, expands the content to full width rather than capping at 720px */
  fluid?: boolean;
}

/**
 * A full-width page with a centered content column. On desktop the title is a
 * document heading inside the page and the header only keeps the titlebar drag
 * region and window controls; on compact the title moves into a back header.
 */
export function PageLayout({
  title,
  onBack,
  testID,
  titleTestID,
  actions,
  children,
  fluid = false,
}: PageLayoutProps) {
  const { theme } = useUnistyles();
  const isCompact = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const scrollContentStyle = useMemo(
    () => ({
      paddingBottom: insets.bottom,
      ...(fluid ? ({ width: "100%", minWidth: "100%" } as const) : {}),
    }),
    [insets.bottom, fluid],
  );
  const showTitle = !isCompact && title !== undefined;

  return (
    <View style={styles.container}>
      {isCompact ? (
        <BackHeader title={title} onBack={onBack} rightContent={actions} />
      ) : (
        <MenuHeader borderless />
      )}
      <ScrollView style={styles.scroll} contentContainerStyle={scrollContentStyle} testID={testID}>
        <View style={[styles.content, fluid && styles.contentFluid]}>
          {showTitle ? (
            <View style={styles.titleRow} testID={titleTestID}>
              <View style={styles.titleLeft}>
                {onBack ? (
                  <Pressable
                    onPress={onBack}
                    style={styles.desktopBackButton}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                    testID="page-layout-back-btn"
                  >
                    <ArrowLeft size={18} color={theme.colors.foregroundMuted} />
                  </Pressable>
                ) : null}
                <Text style={styles.title} testID="page-title">
                  {title}
                </Text>
              </View>
              {actions}
            </View>
          ) : null}
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: theme.spacing[4],
    paddingTop: theme.spacing[6],
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  contentFluid: {
    maxWidth: "100%",
    alignSelf: "stretch",
    paddingHorizontal: theme.spacing[6],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
    marginBottom: theme.spacing[6],
  },
  titleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  desktopBackButton: {
    width: 34,
    height: 34,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    // Line up with the section titles, which sit inset from their cards.
    marginLeft: theme.spacing[1],
    fontSize: theme.fontSize["4xl"],
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
}));
