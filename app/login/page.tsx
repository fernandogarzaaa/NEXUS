import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in — NEXUS" };

export default function LoginPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-10">
      <h1 className="text-xl font-semibold">Sign in to NEXUS</h1>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Enter the access token configured in <code>NEXUS_ACCESS_TOKEN</code>.
      </p>
      <LoginForm />
    </div>
  );
}
