/**
 * Centered card used by the unauthenticated screens (setup, login, invite).
 *
 * The page is the guild-hall wall (`ground`); the card is a sheet of paper with
 * the standard 1.5px `line-strong` outline and the hard 4px offset shadow that
 * DESIGN.md reserves for popovers and dialogs. The large pack icon at the top
 * identifies the screen without adding decorative emoji or extra copy.
 */
import type { ReactNode } from "react";

import type { IconName } from "../../lib/icons";
import Icon from "../Icon";
import { Panel } from "../ui";

export interface AuthPanelProps {
  /** Pack icon shown at the top of the card (native 64px size). */
  icon: IconName;
  /** Page title, rendered as the level-1 heading. */
  title: string;
  /** One-line invitation, e.g. "모험을 시작하세요". */
  heading?: string;
  /** Supporting explanation below the heading. */
  description?: string;
  children?: ReactNode;
}

/** Paper auth card shared by setup, login and invite. */
export function AuthPanel({
  icon,
  title,
  heading,
  description,
  children,
}: AuthPanelProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ground px-4 py-10 text-ink">
      <Panel className="w-full max-w-md shadow-hard">
        <div className="flex flex-col items-center p-4 text-center">
          <Icon name={icon} size={64} />
          <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
          {heading ? (
            <p className="mt-2 text-sm font-medium text-teal">{heading}</p>
          ) : null}
          {description ? (
            <p className="mt-1 text-sm text-muted">{description}</p>
          ) : null}
          {children ? (
            <div className="mt-6 w-full space-y-5 text-left">{children}</div>
          ) : null}
        </div>
      </Panel>
    </main>
  );
}

export default AuthPanel;
