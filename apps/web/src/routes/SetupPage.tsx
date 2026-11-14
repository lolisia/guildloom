/**
 * First-run setup wizard.
 *
 * Creates the first adventurer, their guild and the owner membership through
 * `POST /api/setup` (the API also starts the cookie session), then sends the
 * new guild owner straight to the board. When another device already finished
 * setup the page redirects home instead of rendering the form.
 */
import type { SetupRequest } from "@guildloom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { fetchSetupStatus, setup } from "../api/auth";
import { apiErrorMessage } from "../components/auth/apiErrorMessage";
import AuthPanel from "../components/auth/AuthPanel";
import FormAlert from "../components/auth/FormAlert";
import FormField from "../components/auth/FormField";
import {
  hasErrors,
  validateDisplayName,
  validateGuildName,
  validateLoginId,
  validatePassword,
} from "../components/auth/validation";
import { Button } from "../components/ui";
import { ko } from "../i18n/ko";
import { queryKeys } from "../lib/queryKeys";

interface SetupValues {
  guildName: string;
  displayName: string;
  loginId: string;
  password: string;
  passwordConfirm: string;
}

type SetupFieldErrors = Partial<Record<keyof SetupValues, string>>;

const INITIAL_VALUES: SetupValues = {
  guildName: "",
  displayName: "",
  loginId: "",
  password: "",
  passwordConfirm: "",
};

export default function SetupPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const completedRef = useRef(false);

  const [values, setValues] = useState<SetupValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<SetupFieldErrors>({});

  const setupStatusQuery = useQuery({
    queryKey: queryKeys.setupStatus,
    queryFn: ({ signal }) => fetchSetupStatus(signal),
    retry: false,
  });

  const setupMutation = useMutation({
    mutationFn: (body: SetupRequest) => setup(body),
    onSuccess: (data) => {
      // Keep the gate in sync before navigating: a stale `needsSetup: true`
      // (or a missing session) would bounce us straight back to /setup.
      completedRef.current = true;
      queryClient.setQueryData(queryKeys.setupStatus, { needsSetup: false });
      queryClient.setQueryData(queryKeys.me, { user: data.user });
      navigate(`/g/${data.project.id}`, { replace: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.setupStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });

  const updateField = (field: keyof SetupValues) => (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.currentTarget.value;
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (setupMutation.isPending) {
      return;
    }

    const guildName = values.guildName.trim();
    const displayName = values.displayName.trim();
    const loginId = values.loginId.trim();
    const nextErrors: SetupFieldErrors = {
      guildName: validateGuildName(guildName) ?? undefined,
      displayName: validateDisplayName(displayName) ?? undefined,
      loginId: validateLoginId(loginId) ?? undefined,
      password: validatePassword(values.password) ?? undefined,
      passwordConfirm:
        values.password === values.passwordConfirm
          ? undefined
          : ko.setup.passwordMismatch,
    };

    setErrors(nextErrors);
    if (hasErrors(nextErrors)) {
      return;
    }

    setupMutation.mutate({
      guildName,
      displayName,
      loginId,
      password: values.password,
    });
  };

  if (setupStatusQuery.isPending) {
    return (
      <AuthPanel
        icon="guild"
        title={ko.setup.title}
        description={ko.setup.description}
      >
        <p role="status" className="text-sm text-muted">
          {ko.common.loading}
        </p>
      </AuthPanel>
    );
  }

  if (setupStatusQuery.isError) {
    return (
      <AuthPanel
        icon="guild"
        title={ko.setup.title}
        description={ko.setup.description}
      >
        <p role="alert" className="text-sm text-brick">
          {ko.errors.loadFailed}
        </p>
        <Button
          variant="secondary"
          icon="refresh"
          onClick={() => void setupStatusQuery.refetch()}
        >
          {ko.common.retry}
        </Button>
      </AuthPanel>
    );
  }

  // Setup was completed elsewhere since this tab loaded; there is nothing
  // left to do here. After a successful submit the mutation already navigated.
  if (!completedRef.current && !setupStatusQuery.data.needsSetup) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthPanel
      icon="guild"
      title={ko.setup.title}
      heading={ko.setup.heading}
      description={ko.setup.description}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormField
          id="setup-guild-name"
          label={ko.setup.guildName}
          value={values.guildName}
          onChange={updateField("guildName")}
          placeholder={ko.setup.guildNamePlaceholder}
          maxLength={40}
          autoComplete="organization"
          autoFocus
          required
          error={errors.guildName}
        />

        <FormField
          id="setup-display-name"
          label={ko.setup.displayName}
          value={values.displayName}
          onChange={updateField("displayName")}
          placeholder={ko.setup.displayNamePlaceholder}
          maxLength={20}
          autoComplete="nickname"
          required
          error={errors.displayName}
        />

        <FormField
          id="setup-login-id"
          label={ko.setup.loginId}
          value={values.loginId}
          onChange={updateField("loginId")}
          placeholder={ko.setup.loginIdPlaceholder}
          maxLength={32}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          hint={ko.setup.loginIdHint}
          error={errors.loginId}
        />

        <FormField
          id="setup-password"
          label={ko.setup.password}
          type="password"
          value={values.password}
          onChange={updateField("password")}
          placeholder={ko.setup.passwordPlaceholder}
          autoComplete="new-password"
          required
          icon="key"
          error={errors.password}
        />

        <FormField
          id="setup-password-confirm"
          label={ko.setup.passwordConfirm}
          type="password"
          value={values.passwordConfirm}
          onChange={updateField("passwordConfirm")}
          placeholder={ko.setup.passwordPlaceholder}
          autoComplete="new-password"
          required
          icon="key"
          error={errors.passwordConfirm}
        />

        <FormAlert
          message={
            setupMutation.isError
              ? apiErrorMessage(setupMutation.error, ko.setup.failed)
              : null
          }
        />

        <Button
          type="submit"
          variant="primary"
          icon="guild"
          className="w-full"
          disabled={setupMutation.isPending}
        >
          {setupMutation.isPending ? ko.setup.submitting : ko.setup.submit}
        </Button>
      </form>
    </AuthPanel>
  );
}
