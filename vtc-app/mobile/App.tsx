import { StatusBar } from "expo-status-bar";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

function getWidgetUrl() {
  const raw = String(process.env.EXPO_PUBLIC_WIDGET_URL || "").trim();
  return raw;
}

export default function App() {
  const widgetUrl = useMemo(() => getWidgetUrl(), []);
  const [isLoading, setIsLoading] = useState(true);

  if (!widgetUrl) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Configuration requise</Text>
          <Text style={styles.text}>
            Définis EXPO_PUBLIC_WIDGET_URL (voir .env.example) pour charger ta page Shopify contenant le widget.
          </Text>
        </View>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <WebView
          source={{ uri: widgetUrl }}
          onLoadEnd={() => setIsLoading(false)}
          startInLoadingState
          javaScriptEnabled
          domStorageEnabled
          allowsBackForwardNavigationGestures
        />
        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" />
          </View>
        ) : null}
      </View>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1 },
  loadingOverlay: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.75)",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 18, fontWeight: "600", marginBottom: 10 },
  text: { fontSize: 14, opacity: 0.8, textAlign: "center" },
});
