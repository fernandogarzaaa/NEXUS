import LoginForm from "./LoginForm";
import { usersMode, type AuthEnv } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — NEXUS" };

export default function LoginPage() {
  const named = usersMode(process.env as AuthEnv);
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-10">
      <h1 className="text-xl font-semibold">Sign in to NEXUS</h1>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {named ? "Sign in with your NEXUS username and password." : <>Enter the access token configured in <code>NEXUS_ACCESS_TOKEN</code>.</>}
      </p>
      <LoginForm named={named} />
    </div>
  );
}
