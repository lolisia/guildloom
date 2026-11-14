/**
 * Public invite landing page (`/invite/:code`).
 *
 * Invites are reusable links. Signed-out visitors can create an account and
 * join in one step (`/signup`); signed-in adventurers get a join button
 * (`/join`, which is idempotent server-side). Unknown and revoked codes show
 * the Korean invalid-invite message plus a login link.
 */
import type {
  InviteSignupRequest,
  InviteSignupResponse,
  MeResponse,
} from "@guildloom/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { fetchMe } from "../api/auth";
import {
  fetchInviteInfo,
  inviteInfoQueryKey,
  joinInvite,
  signupWithInvite,
} from "../api/invites";
import { apiErrorMessage } from "../components/auth/apiErrorMessage";
import AuthPanel from "../components/auth/AuthPanel";
import FormAlert from "../components/auth/FormAlert";
import FormField from "../components/auth/FormField";
import {
  hasErrors,
  validateDisplayName,
  validateLoginId,
  validatePassword,
} from "../components/auth/validation";
import Icon from "../components/Icon";
import { Button, Panel } from "../components/ui";
import { ko } from "../i18n/ko";
import { queryKeys } from "../lib/queryKeys";

interface SignupValues {
  displayName: string;
  loginId: string;
  password: string;
  passwordConfirm: string;
}

type SignupFieldErrors = Partial<Record<keyof SignupValues, string>>;

/** Invalid/revoked invite state: Korean message plus a way to sign in. */
function InvalidInvite() {
  return (
    <AuthPanel
      icon="invite"
      title={ko.invite.title}
      heading={ko.invite.heading}
      description={ko.invite.description}
    >
      <p role="alert" className="text-sm text-brick">
        {ko.invite.invalid}
      </p>
      <Link
        to="/login"
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border-[1.5px] border-line-strong bg-paper px-3 text-sm font-medium text-ink"
      >
        <Icon name="login" size={32} />
        {ko.invite.loginLink}
      </Link>
    </AuthPanel>
  );
}

/** Signup card for an anonymous visitor holding a valid invite. */
function SignupForm({ code }: { code: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [values, setValues] = useState<SignupValues>({
    displayName: "",
    loginId: "",
    password: "",
    passwordConfirm: "",
  });
  const [errors, setErrors] = useState<SignupFieldErrors>({});

  const signupMutation = useMutation({
    mutationFn: (body: InviteSignupRequest) =>
      signupWithInvite(code, body),
    onSuccess: (data: InviteSignupResponse) => {
      // The API signed the new adventurer in; prime the cache so the gate
      // renders the guild board instead of bouncing back to /login.
      queryClient.setQueryData(queryKeys.setupStatus, { needsSetup: false });
      queryClient.setQueryData<MeResponse>(queryKeys.me, { user: data.user });
      navigate(`/g/${data.projectId}`, { replace: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.setupStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });

  const updateField = (field: keyof SignupValues) => (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.currentTarget.value;
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (signupMutation.isPending) {
      return;
    }

    const displayName = values.displayName.trim();
    const loginId = values.loginId.trim();
    const nextErrors: SignupFieldErrors = {
      displayName: validateDisplayName(displayName) ?? undefined,
      loginId: validateLoginId(loginId) ?? undefined,
      password: validatePassword(values.password) ?? undefined,
      passwordConfirm:
        values.password === values.passwordConfirm
          ? undefined
          : ko.invite.passwordMismatch,
    };

    setErrors(nextErrors);
    if (hasErrors(nextErrors)) {
      return;
    }

    signupMutation.mutate({
      displayName,
      loginId,
      password: values.password,
    });
  };

  const serverError = signupMutation.isError
    ? apiErrorMessage(signupMutation.error, ko.invite.signupFailed)
    : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <h2 className="text-sm font-semibold text-ink">
          {ko.invite.signupTitle}
        </h2>
        <p className="mt-1 text-xs text-muted">{ko.invite.signupDescription}</p>
      </div>

      <FormField
        id="invite-display-name"
        label={ko.invite.displayName}
        value={values.displayName}
        onChange={updateField("displayName")}
        placeholder={ko.invite.displayNamePlaceholder}
        maxLength={20}
        autoComplete="nickname"
        autoFocus
        required
        error={errors.displayName}
      />

      <FormField
        id="invite-login-id"
        label={ko.invite.loginId}
        value={values.loginId}
        onChange={updateField("loginId")}
        placeholder={ko.invite.loginIdPlaceholder}
        maxLength={32}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        error={errors.loginId}
      />

      <FormField
        id="invite-password"
        label={ko.invite.password}
        type="password"
        value={values.password}
        onChange={updateField("password")}
        placeholder={ko.invite.passwordPlaceholder}
        autoComplete="new-password"
        required
        icon="key"
        error={errors.password}
      />

      <FormField
        id="invite-password-confirm"
        label={ko.invite.passwordConfirm}
        type="password"
        value={values.passwordConfirm}
        onChange={updateField("passwordConfirm")}
        placeholder={ko.invite.passwordPlaceholder}
        autoComplete="new-password"
        required
        icon="key"
        error={errors.passwordConfirm}
      />

      <FormAlert message={serverError} />

      <Button
        type="submit"
        variant="primary"
        icon="invite"
        className="w-full"
        disabled={signupMutation.isPending}
      >
        {signupMutation.isPending
          ? ko.invite.signingUp
          : ko.invite.signup}
      </Button>
    </form>
  );
}

/** Join card for a signed-in adventurer holding a valid invite. */
function JoinForm({ code }: { code: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const joinMutation = useMutation({
    mutationFn: () => joinInvite(code),
    onSuccess: (data) => {
      // The endpoint is idempotent: 200 also means "already a member".
      navigate(`/g/${data.projectId}`, { replace: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.project(data.projectId),
      });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">
          {ko.invite.joinTitle}
        </h2>
        <p className="mt-1 text-xs text-muted">{ko.invite.joinDescription}</p>
      </div>

      <FormAlert
        message={
          joinMutation.isError
            ? apiErrorMessage(joinMutation.error, ko.invite.joinFailed)
            : null
        }
      />

      <Button
        type="button"
        variant="primary"
        icon="login"
        className="w-full"
        onClick={() => joinMutation.mutate()}
        disabled={joinMutation.isPending}
      >
        {joinMutation.isPending ? ko.invite.joining : ko.invite.join}
      </Button>
    </div>
  );
}

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const inviteCode = code ?? "";

  const inviteQuery = useQuery({
    queryKey: inviteInfoQueryKey(inviteCode),
    queryFn: ({ signal }) => fetchInviteInfo(inviteCode, signal),
    enabled: inviteCode.length > 0,
    retry: false,
  });

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
  });

  if (!inviteCode) {
    return <InvalidInvite />;
  }

  if (inviteQuery.isPending) {
    return (
      <AuthPanel
        icon="invite"
        title={ko.invite.title}
        heading={ko.invite.heading}
        description={ko.invite.loading}
      >
        <p role="status" className="text-sm text-muted">
          {ko.invite.loading}
        </p>
      </AuthPanel>
    );
  }

  // Unknown codes surface as 404; revoked codes report `valid: false`.
  if (inviteQuery.isError || !inviteQuery.data.valid) {
    return <InvalidInvite />;
  }

  const invite = inviteQuery.data;
  const user = meQuery.data?.user ?? null;

  return (
    <AuthPanel
      icon="invite"
      title={ko.invite.title}
      heading={ko.invite.heading}
      description={ko.invite.description}
    >
      <Panel>
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-muted">{ko.invite.projectName}</dt>
            <dd className="font-semibold text-ink">{invite.projectName}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-xs text-muted">{ko.invite.code}</dt>
            <dd>
              <code className="rounded-sm bg-sunken px-1.5 py-0.5 font-pixel text-xs text-teal">
                {inviteCode}
              </code>
            </dd>
          </div>
        </dl>
      </Panel>

      {meQuery.isPending ? (
        <p role="status" className="text-sm text-muted">
          {ko.common.loading}
        </p>
      ) : user ? (
        <JoinForm code={inviteCode} />
      ) : (
        <SignupForm code={inviteCode} />
      )}
    </AuthPanel>
  );
}
