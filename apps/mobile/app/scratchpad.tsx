import type { ScratchpadItem } from "@rakazo/contracts";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import {
  confirmRemoval,
  SettingsButton,
  SettingsChoices,
  SettingsField,
  SettingsPage,
  SettingsText,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function Scratchpad() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const { t } = useI18n();
  const action = useSettingsAction();
  const resource = useSettingsResource(
    useCallback(
      () => rpc<ScratchpadItem[]>("scratchpad/list", { botId, includeDone: true }),
      [botId],
    ),
    `scratchpad:${botId}`,
  );
  const [open, setOpen] = useState<ScratchpadItem | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<ScratchpadItem["status"]>("open");
  return (
    <SettingsPage
      title={t("Scratchpad")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      {open ? (
        <>
          <SettingsField label={t("Title")} value={title} onChangeText={setTitle} maxLength={200} />
          <SettingsField
            label={t("Notes")}
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={4000}
          />
          <SettingsChoices
            label={t("Status")}
            value={status}
            choices={[
              { value: "open", label: t("Open") },
              { value: "parked", label: t("Parked") },
              { value: "done", label: t("Done") },
            ]}
            onChange={setStatus}
          />
          <SettingsButton
            label={t("Save")}
            primary
            disabled={action.busy || !title.trim()}
            onPress={() =>
              void action.run(async () => {
                await rpc(open === "new" ? "scratchpad/create" : "scratchpad/update", {
                  ...(open === "new" ? { botId } : { itemId: open.id }),
                  title: title.trim(),
                  notes,
                  status,
                });
                setOpen(null);
                await resource.reload();
              })
            }
          />
          <SettingsButton
            label={t("Cancel")}
            disabled={action.busy}
            onPress={() => setOpen(null)}
          />
        </>
      ) : (
        <>
          <SettingsButton
            label={t("New item")}
            primary
            onPress={() => {
              setOpen("new");
              setTitle("");
              setNotes("");
              setStatus("open");
            }}
          />
          {resource.data?.length === 0 ? (
            <SettingsText>{t("No scratchpad items yet.")}</SettingsText>
          ) : null}
          {resource.data?.map((item) => (
            <View key={item.id} style={{ gap: 8 }}>
              <SettingsButton
                label={`${item.title} · ${t(item.status)}`}
                onPress={() => {
                  setOpen(item);
                  setTitle(item.title);
                  setNotes(item.notes);
                  setStatus(item.status);
                }}
              />
              <SettingsButton
                label={t("Delete {name}", { name: item.title })}
                destructive
                disabled={action.busy}
                onPress={() =>
                  confirmRemoval(
                    t("Delete {name}?", { name: item.title }),
                    () =>
                      void action.run(async () => {
                        await rpc("scratchpad/remove", { itemId: item.id });
                        await resource.reload();
                      }),
                  )
                }
              />
            </View>
          ))}
        </>
      )}
    </SettingsPage>
  );
}
