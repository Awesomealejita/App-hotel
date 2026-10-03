import { useEffect, useState } from "react";
import { AlertTriangle, MessageSquare } from "lucide-react";
import { photoUrl } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { Profile, WorkOrderNote } from "../lib/types";
import { cx } from "./ui";

/** Hilo de observaciones / incidencias de una orden, con fotos. */
export default function OrderTimeline({ notes, staffById }: { notes: WorkOrderNote[]; staffById: Map<string, Profile> }) {
  if (notes.length === 0) return <p className="text-sm text-slate-500">Sin observaciones.</p>;
  return (
    <ul className="space-y-2">
      {notes.map((n) => (
        <li key={n.id} className={cx("rounded-lg p-3 text-sm", n.is_issue ? "bg-rose-50 ring-1 ring-rose-200" : "bg-slate-50")}>
          <div className="flex gap-2">
            {n.is_issue ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /> : <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap">{n.body}</p>
              {n.photo_path && <NotePhoto path={n.photo_path} />}
              <p className="mt-1 text-xs text-slate-500">
                {n.author_id ? staffById.get(n.author_id)?.full_name : "—"} · {fmtDateTime(n.created_at)}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function NotePhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    photoUrl(path).then(setUrl);
  }, [path]);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Foto adjunta" className="mt-2 max-h-48 rounded-lg object-cover" />
    </a>
  );
}
