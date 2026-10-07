import { deviceSupportRows, type DeviceCell, type SupportLevel } from "../../data/deviceSupport";

const LEVEL_TONE: Record<SupportLevel, string> = {
  yes: "text-success",
  partial: "text-warning",
  no: "text-ink-muted",
  na: "text-ink-muted",
};

function Cell({ cell }: { cell: DeviceCell }) {
  return (
    <td className="px-3 py-2.5 align-top">
      <span className={`text-sm font-medium ${LEVEL_TONE[cell.level]}`}>{cell.label}</span>
      {cell.note && <span className="mt-0.5 block text-xs leading-snug text-ink-muted">{cell.note}</span>}
    </td>
  );
}

/**
 * Settings > About: which device each model can generate on. Kwesi picks the
 * best one a model supports unless "Run models on" (Settings > System) is set
 * to CPU only.
 */
export function DeviceSupportTable() {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr className="border-b border-ink/[0.07] text-xs text-ink-muted">
              <th scope="col" className="py-2 pr-3 font-normal">
                Model
              </th>
              <th scope="col" className="px-3 py-2 font-normal">
                NVIDIA GPU
              </th>
              <th scope="col" className="px-3 py-2 font-normal">
                Apple GPU (Metal)
              </th>
              <th scope="col" className="px-3 py-2 font-normal">
                CPU
              </th>
            </tr>
          </thead>
          <tbody>
            {deviceSupportRows().map((row) => (
              <tr key={row.modelId} className="border-b border-ink/[0.07] last:border-b-0">
                <th scope="row" className="py-2.5 pr-3 align-top text-sm font-medium">
                  {row.displayName}
                </th>
                <Cell cell={row.nvidia} />
                <Cell cell={row.apple} />
                <Cell cell={row.cpu} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">
        Kwesi uses the best device each model supports: an NVIDIA GPU, then Apple's GPU, then the CPU. To keep
        everything on the CPU, set Run models on to CPU only in Settings → System. AMD and Intel GPUs aren't set up
        by Kwesi, so models run on the CPU there. Apple GPU support hasn't been confirmed on a Mac yet.
      </p>
    </div>
  );
}
