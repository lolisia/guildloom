/**
 * Guild name editor.
 *
 * Only the guild owner can rename the guild (`PATCH /api/projects/:pid`); every
 * other member sees the current name as read-only text.
 */
import type { ProjectDetailResponse } from "@guildloom/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";

import { updateProject } from "../../api/projects";
import { ko } from "../../i18n/ko";
import { isImeComposing } from "../../lib/ime";
import { queryKeys } from "../../lib/queryKeys";
import { apiErrorMessage } from "../auth/apiErrorMessage";
import FormAlert from "../auth/FormAlert";
import FormField from "../auth/FormField";
import { validateGuildName } from "../auth/validation";
import { Button, Panel } from "../ui";

export interface GuildNameFormProps {
  projectId: number;
  projectName: string;
  /** Only owners may submit the form. */
  isOwner: boolean;
}

/** Owner-only guild rename form with a read-only fallback. */
export function GuildNameForm({
  projectId,
  projectName,
  isOwner,
}: GuildNameFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(projectName);
  const [error, setError] = useState<string | null>(null);

  // Keep the input in sync when the guild is renamed elsewhere or the route
  // switches to another guild.
  useEffect(() => {
    setName(projectName);
  }, [projectName]);

  const renameMutation = useMutation({
    mutationFn: (nextName: string) =>
      updateProject(projectId, { name: nextName }),
    onSuccess: (project) => {
      queryClient.setQueryData<ProjectDetailResponse | undefined>(
        queryKeys.project(projectId),
        (previous) =>
          previous ? { ...previous, project } : previous,
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.project(projectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setName(event.currentTarget.value);
    setError(null);
  };

  // A composition Enter must not implicitly submit the single-input form; a
  // regular Enter still submits the rename.
  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && isImeComposing(event)) {
      event.preventDefault();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (renameMutation.isPending) {
      return;
    }

    const nextName = name.trim();
    const validationError = validateGuildName(nextName);
    setError(validationError);
    if (validationError) {
      return;
    }
    if (nextName === projectName) {
      return;
    }

    renameMutation.mutate(nextName);
  };

  if (!isOwner) {
    return (
      <Panel className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">
          {ko.settings.guildName}
        </h2>
        <p
          data-testid="guild-name"
          className="text-lg font-semibold text-ink"
        >
          {projectName}
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormField
          id="guild-settings-name"
          label={ko.settings.guildName}
          value={name}
          onChange={handleChange}
          onKeyDown={handleNameKeyDown}
          placeholder={ko.settings.guildNamePlaceholder}
          maxLength={40}
          required
          error={error}
        />

        <FormAlert
          message={
            renameMutation.isError
              ? apiErrorMessage(renameMutation.error, ko.settings.saveFailed)
              : null
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            icon="save"
            disabled={renameMutation.isPending || name.trim() === ""}
          >
            {renameMutation.isPending
              ? ko.settings.saving
              : ko.settings.saveGuildName}
          </Button>
          {renameMutation.isSuccess ? (
            <p role="status" className="text-xs text-teal">
              {ko.settings.saved}
            </p>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}

export default GuildNameForm;
