"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";
import { Router } from "@/components/router";

export default function ClinicPage() {
  const params = useParams<{ slug?: string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug : [];
  return (
    <Suspense fallback={<div className="page">Loading…</div>}>
      <Router slug={slug} />
    </Suspense>
  );
}
