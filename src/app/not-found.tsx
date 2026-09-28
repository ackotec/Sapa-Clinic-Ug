import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <div className="card card-pad">
        <h1 className="display">Page not found</h1>
        <p>That section is not part of SAPA Clinic.</p>
        <Link className="btn" href="/dashboard">Back to dashboard</Link>
      </div>
    </main>
  );
}
