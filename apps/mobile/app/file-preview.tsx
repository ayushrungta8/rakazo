import { ChatMarkdown } from "@rakazo/chat-ui/native";
import type { ArtifactVersion, ArtifactWithContent } from "@rakazo/contracts";
import { File, Paths } from "expo-file-system";
import { requireOptionalNativeModule } from "expo-modules-core";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useState } from "react";
import { Image, View } from "react-native";
import { WebView } from "react-native-webview";
import {
  SettingsButton,
  SettingsPage,
  SettingsText,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import { rpc } from "../lib/api";
import { artifactCacheFileName } from "../lib/artifact-file";
import { loadArtifactPreview } from "../lib/artifact-preview";
import { useI18n } from "../lib/i18n";

type PdfPage = { count: number; width: number; height: number; image: string };
const documents = requireOptionalNativeModule<{
  pdfPage: (uri: string, page: number) => Promise<PdfPage>;
}>("RakazoDocuments");
export default function FilePreview() {
  const { artifactId } = useLocalSearchParams<{ artifactId: string }>();
  const { t } = useI18n();
  const action = useSettingsAction();
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pdf, setPdf] = useState<PdfPage | null>(null);
  const [uri, setUri] = useState("");
  const [text, setText] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const resource = useSettingsResource(
    useCallback(
      () =>
        loadArtifactPreview(artifactId, selected, {
          versions: (familyId) => rpc<ArtifactVersion[]>("artifacts/listVersions", { familyId }),
          artifact: (id) => rpc<ArtifactWithContent>("artifacts/getById", { artifactId: id }),
        }),
      [selected, artifactId],
    ),
  );
  useEffect(() => {
    let live = true;
    const artifact = resource.data?.artifact;
    setUri("");
    setText("");
    setPreviewError(null);
    setPage(0);
    if (!artifact) return;
    const file = new File(Paths.cache, artifactCacheFileName(artifact.id, artifact.mimeType));
    try {
      file.create({ overwrite: true });
      file.write(artifact.contentBase64, { encoding: "base64" });
      setUri(file.uri);
      if (artifact.mimeType.startsWith("text/") || artifact.mimeType === "application/json") {
        void file
          .text()
          .then((next) => {
            if (live) setText(next);
          })
          .catch((err) => {
            if (live) setPreviewError(err instanceof Error ? err.message : String(err));
          });
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    }
    return () => {
      live = false;
    };
  }, [resource.data?.artifact]);
  useEffect(() => {
    let live = true;
    setPdf(null);
    if (resource.data?.artifact.mimeType === "application/pdf" && documents && uri) {
      setPreviewError(null);
      void documents
        .pdfPage(uri, page)
        .then((next) => {
          if (live) setPdf(next);
        })
        .catch((err) => {
          if (live) setPreviewError(err instanceof Error ? err.message : String(err));
        });
    }
    return () => {
      live = false;
    };
  }, [resource.data?.artifact.mimeType, uri, page]);
  const artifact = resource.data?.artifact;
  return (
    <SettingsPage
      title={artifact?.name ?? t("File")}
      loading={resource.loading}
      error={previewError ?? action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      {artifact ? (
        <>
          <SettingsButton
            label={t("Share or save")}
            disabled={!uri || action.busy}
            onPress={() =>
              void action.run(async () => {
                if (!(await Sharing.isAvailableAsync()))
                  throw new Error(t("Sharing is unavailable"));
                await Sharing.shareAsync(uri, { mimeType: artifact.mimeType });
              })
            }
          />
          {artifact.mimeType.startsWith("image/") ? (
            <Image
              source={{ uri }}
              resizeMode="contain"
              style={{ width: "100%", height: 400 }}
              accessibilityLabel={artifact.name}
            />
          ) : artifact.mimeType === "text/html" ? (
            <View style={{ height: 500 }}>
              <WebView
                source={{
                  html: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:">${text}`,
                }}
                javaScriptEnabled={false}
                domStorageEnabled={false}
                allowFileAccess={false}
                allowFileAccessFromFileURLs={false}
                allowUniversalAccessFromFileURLs={false}
                mixedContentMode="never"
                setSupportMultipleWindows={false}
                onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
              />
            </View>
          ) : /markdown/.test(artifact.mimeType) || /\.md$/i.test(artifact.name) ? (
            <ChatMarkdown>{text}</ChatMarkdown>
          ) : artifact.mimeType === "application/pdf" ? (
            pdf ? (
              <>
                <SettingsText>
                  {t("Page {page} of {count}", { page: page + 1, count: pdf.count })}
                </SettingsText>
                <Image
                  source={{ uri: pdf.image }}
                  style={{ width: "100%", aspectRatio: pdf.width / pdf.height }}
                  accessibilityLabel={t("Page {page}", { page: page + 1 })}
                />
                <SettingsButton
                  label={t("Previous page")}
                  disabled={page === 0}
                  onPress={() => setPage((p) => p - 1)}
                />
                <SettingsButton
                  label={t("Next page")}
                  disabled={page + 1 >= pdf.count}
                  onPress={() => setPage((p) => p + 1)}
                />
              </>
            ) : (
              <SettingsText>
                {previewError
                  ? t("Preview unavailable.")
                  : documents
                    ? t("Rendering PDF…")
                    : t("Use Share or save to open this PDF.")}
              </SettingsText>
            )
          ) : text ? (
            <SettingsText>{text}</SettingsText>
          ) : (
            <SettingsText>{t("Use Share or save to open this file.")}</SettingsText>
          )}
          {resource.data && resource.data.versions.length > 1 ? (
            <>
              <SettingsText>{t("Versions")}</SettingsText>
              {resource.data.versions.map((version) => (
                <SettingsButton
                  key={version.id}
                  label={`${version.version} · ${new Date(version.createdAt).toLocaleString()}`}
                  disabled={artifact.id === version.id}
                  onPress={() => {
                    setPage(0);
                    setSelected(version.id);
                  }}
                />
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </SettingsPage>
  );
}
