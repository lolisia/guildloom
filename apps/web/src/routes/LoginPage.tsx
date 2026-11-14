/**
 * Login screen.
 *
 * `POST /api/auth/login` starts the cookie session. On success the adventurer
 * returns to the guild they last visited (`gl:lastProject`) or to `/`, which
 * redirects to their first guild. Invalid credentials get the Korean
 * `ko.login.invalidCredentials` copy instead of the server's English message.
 */
import type { LoginRequest, MeResponse } from "@guildloom/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { login } from "../api/auth";
import { ApiClientError } from "../api/client";
import { apiErrorMessage } from "../components/auth/apiErrorMessage";
import AuthPanel from "../components/auth/AuthPanel";
import FormAlert from "../components/auth/FormAlert";
import FormField from "../components/auth/FormField";
import {
  hasErrors,
  validateLoginId,
  validatePassword,
} from "../components/auth/validation";
import { LAST_PROJECT_STORAGE_KEY } from "../components/AppLayout";
import { Button } from "../components/ui";
import { ko } from "../i18n/ko";
import { queryKeys } from "../lib/queryKeys";

interface LoginValues {
  loginId: string;
  password: string;
}

type LoginFieldErrors = Partial<Record<keyof LoginValues, string>>;

/** Project id remembered by {@link AppLayout}, if any. */
function readLastProjectId(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [values, setValues] = useState<LoginValues>({
    loginId: "",
    password: "",
  });
  const [errors, setErrors] = useState<LoginFieldErrors>({});

  const loginMutation = useMutation({
    mutationFn: (body: LoginRequest) => login(body),
    onSuccess: (data) => {
      // Cache the fresh session so the gate leaves /login immediately, even
      // before the invalidation refetch below lands.
      queryClient.setQueryData<MeResponse>(queryKeys.me, { user: data.user });
      const lastProjectId = readLastProjectId();
      navigate(lastProjectId === null ? "/" : `/g/${lastProjectId}`, {
        replace: true,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });

  const updateField = (field: keyof LoginValues) => (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.currentTarget.value;
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginMutation.isPending) {
      return;
    }

    const loginId = values.loginId.trim();
    const nextErrors: LoginFieldErrors = {
      loginId: validateLoginId(loginId) ?? undefined,
      password: validatePassword(values.password) ?? undefined,
    };

    setErrors(nextErrors);
    if (hasErrors(nextErrors)) {
      return;
    }

    loginMutation.mutate({ loginId, password: values.password });
  };

  const serverError = loginMutation.isError
    ? loginMutation.error instanceof ApiClientError &&
      loginMutation.error.status === 401
      ? ko.login.invalidCredentials
      : apiErrorMessage(loginMutation.error, ko.login.failed)
    : null;

  return (
    <AuthPanel
      icon="login"
      title={ko.login.title}
      heading={ko.login.heading}
      description={ko.login.description}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormField
          id="login-id"
          label={ko.login.loginId}
          value={values.loginId}
          onChange={updateField("loginId")}
          placeholder={ko.login.loginIdPlaceholder}
          maxLength={32}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
          error={errors.loginId}
        />

        <FormField
          id="login-password"
          label={ko.login.password}
          type="password"
          value={values.password}
          onChange={updateField("password")}
          placeholder={ko.login.passwordPlaceholder}
          autoComplete="current-password"
          required
          icon="key"
          error={errors.password}
        />

        <FormAlert message={serverError} />

        <Button
          type="submit"
          variant="primary"
          icon="login"
          className="w-full"
          disabled={loginMutation.isPending}
        >
          {loginMutation.isPending ? ko.login.submitting : ko.login.submit}
        </Button>
      </form>
    </AuthPanel>
  );
}
