import type { IntegrationCatalogResult } from "@rakazo/contracts";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsText,
  useSettingsAction,
} from "../components/settings-controls";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { catalogImport } from "../lib/integration-catalog";

export default function IntegrationCatalog() {
  const { t } = useI18n();
  const router = useRouter();
  const action = useSettingsAction();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IntegrationCatalogResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [enabled, setEnabled] = useState(true);
  async function search() {
    await action.run(async () => {
      const response = await rpc<{ enabled: boolean; results: IntegrationCatalogResult[] }>(
        "capabilities/catalogSearch",
        { query: query.trim() },
      );
      setEnabled(response.enabled);
      setResults(response.results);
      setSearched(true);
    });
  }
  return (
    <SettingsPage title={t("Integration catalog")} error={action.error}>
      <SettingsField
        label={t("Search")}
        value={query}
        onChangeText={setQuery}
        maxLength={253}
        onSubmitEditing={() => void search()}
        returnKeyType="search"
      />
      <SettingsButton
        label={t("Search")}
        primary
        disabled={action.busy}
        onPress={() => void search()}
      />
      {searched && !enabled ? (
        <SettingsText>{t("Catalog search is not configured on this server.")}</SettingsText>
      ) : searched && results.length === 0 ? (
        <SettingsText>{t("No integrations found.")}</SettingsText>
      ) : null}
      {results.map((result) => (
        <View key={result.domain} style={{ gap: 8 }}>
          <SettingsText>{result.name}</SettingsText>
          {result.description ? <SettingsText>{result.description}</SettingsText> : null}
          {result.surfaces.map((surface) => {
            const prefill = catalogImport(result, surface);
            return prefill ? (
              <SettingsButton
                key={`${surface.kind}:${surface.slug}`}
                label={t("Add {type}", { type: surface.kind.toUpperCase() })}
                onPress={() =>
                  router.push({
                    pathname: "/integrations",
                    params: {
                      ...prefill,
                      importKey: `${result.domain}:${surface.slug}:${Date.now()}`,
                    },
                  })
                }
              />
            ) : (
              <SettingsText
                key={`${surface.kind}:${surface.slug}`}
              >{`${surface.kind.toUpperCase()} · ${t("No importable endpoint")}`}</SettingsText>
            );
          })}
        </View>
      ))}
    </SettingsPage>
  );
}
