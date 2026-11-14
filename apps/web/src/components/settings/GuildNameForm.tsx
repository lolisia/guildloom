/**
 * Guild name editor.
 *
 * Only the guild owner can rename the guild (`PATCH /api/projects/:pid`); every
 * other member sees the current name as read-only text.
 */
import type { ProjectDetailResponse } from "@guildloom/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import { updateProject } from "../../api/projects";
import { ko } from "../../i18n/ko";
import { queryKeys } from "../../lib/queryKeys";
import { apiErrorMessage } from "../auth/apiErrorMessage";
import FormAlert from "../auth/FormAlert";
import FormField from "../auth/FormField";
import { validateGuildName } from "../auth/validation";

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
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="text-sm font-bold text-slate-200">
          {ko.settings.guildName}
        </h2>
        <p
          data-testid="guild-name"
          className="mt-2 text-lg font-semibold text-slate-100"
        >
          {projectName}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormField
          id="guild-settings-name"
          label={ko.settings.guildName}
          value={name}
          onChange={handleChange}
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
          <button
            type="submit"
            disabled={renameMutation.isPending || name.trim() === ""}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {renameMutation.isPending
              ? ko.settings.saving
              : ko.settings.saveGuildName}
          </button>
          {renameMutation.isSuccess ? (
            <p role="status" className="text-xs text-emerald-300">
              {ko.settings.saved}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

export default GuildNameForm;
