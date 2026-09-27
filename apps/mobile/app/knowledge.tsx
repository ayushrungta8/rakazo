import type { AgentSkill, AgentSkillCatalogEntry, MemoryDocument } from "@rakazo/contracts";
import { File, Paths } from "expo-file-system";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useState } from "react";
import { View } from "react-native";
import {
  confirmRemoval,
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsText,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function Knowledge() {
  const { botId } = useLocalSearchParams<{ botId?: string }>();
  const { t } = useI18n();
  const action = useSettingsAction();
  const resource = useSettingsResource(
    useCallback(async () => {
      const [documents, skills] = await Promise.all([
        rpc<MemoryDocument[]>("memory/list", botId ? { botId, scope: "bot" } : { scope: "user" }),
        rpc<AgentSkillCatalogEntry[]>("agentSkills/list"),
      ]);
      return { documents, skills };
    }, [botId]),
  );
  const [document, setDocument] = useState<MemoryDocument | null>(null);
  const [skill, setSkill] = useState<AgentSkill | "new" | null>(null);
  const [content, setContent] = useState("");
  const editing = !!document || !!skill;
  const readOnly = !!skill && skill !== "new" && skill.readOnly;
  return (
    <SettingsPage
      title={t("Knowledge & skills")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      {editing ? (
        <>
          <SettingsText>
            {document?.path ?? (skill === "new" ? t("New skill") : skill?.name)}
          </SettingsText>
          {readOnly ? <SettingsText>{t("This skill is read-only.")}</SettingsText> : null}
          <SettingsField
            label={document ? t("Memory content") : "SKILL.md"}
            multiline
            value={content}
            onChangeText={setContent}
            editable={!readOnly && !action.busy}
            style={{ minHeight: 300 }}
          />
          {!readOnly ? (
            <SettingsButton
              label={t("Save")}
              primary
              disabled={action.busy || (!document && !content.trim())}
              onPress={() =>
                void action.run(async () => {
                  if (document) await rpc("memory/update", { documentId: document.id, content });
                  else if (skill === "new") await rpc("agentSkills/create", { content });
                  else if (skill) await rpc("agentSkills/update", { skillId: skill.id, content });
                  setDocument(null);
                  setSkill(null);
                  setContent("");
                  await resource.reload();
                })
              }
            />
          ) : null}
          <SettingsButton
            label={t("Close editor")}
            disabled={action.busy}
            onPress={() => {
              setDocument(null);
              setSkill(null);
              setContent("");
            }}
          />
        </>
      ) : (
        <>
          <SettingsText>{t("Memory")}</SettingsText>
          {resource.data?.documents.length === 0 ? (
            <SettingsText>{t("No memory documents yet.")}</SettingsText>
          ) : null}
          {resource.data?.documents.map((doc) => (
            <SettingsButton
              key={doc.id}
              label={doc.path}
              onPress={() => {
                setDocument(doc);
                setContent(doc.content);
              }}
            />
          ))}
          {resource.data?.documents.length ? (
            <SettingsButton
              label={t("Export memory")}
              disabled={action.busy}
              onPress={() =>
                void action.run(async () => {
                  if (!(await Sharing.isAvailableAsync()))
                    throw new Error(t("Sharing is unavailable"));
                  const documents = await rpc<MemoryDocument[]>(
                    "memory/list",
                    botId ? { botId, scope: "bot" } : { scope: "user" },
                  );
                  resource.setData((current) => (current ? { ...current, documents } : current));
                  const file = new File(Paths.cache, "memory-export.md");
                  try {
                    file.create({ overwrite: true });
                    file.write(
                      documents.map((doc) => `# ${doc.path}\n\n${doc.content}`).join("\n\n"),
                    );
                    await Sharing.shareAsync(file.uri, { mimeType: "text/markdown" });
                  } finally {
                    try {
                      file.delete();
                    } catch {
                      /* Best effort cache cleanup. */
                    }
                  }
                })
              }
            />
          ) : null}
          <SettingsText>{t("Skills")}</SettingsText>
          <SettingsButton
            label={t("New skill")}
            primary
            onPress={() => {
              setSkill("new");
              setContent(
                "---\nname: new-skill\ndescription: When to use this skill\n---\n\n# Instructions\n\n",
              );
            }}
          />
          {resource.data?.skills.map((entry) => (
            <View key={entry.id} style={{ gap: 8 }}>
              <SettingsButton
                label={entry.name}
                disabled={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    const loaded = await rpc<AgentSkill>("agentSkills/get", { skillId: entry.id });
                    setSkill(loaded);
                    setContent(loaded.content);
                  })
                }
              />
              <SettingsText>{entry.description}</SettingsText>
              {!entry.readOnly ? (
                <SettingsButton
                  label={t("Delete {name}", { name: entry.name })}
                  destructive
                  disabled={action.busy}
                  onPress={() =>
                    confirmRemoval(
                      t("Delete {name}?", { name: entry.name }),
                      () =>
                        void action.run(async () => {
                          await rpc("agentSkills/remove", { skillId: entry.id });
                          await resource.reload();
                        }),
                    )
                  }
                />
              ) : null}
            </View>
          ))}
        </>
      )}
    </SettingsPage>
  );
}
