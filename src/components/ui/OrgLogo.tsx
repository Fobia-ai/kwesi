import aceStepLogo from "../../assets/orgLogos/ace-step.png";
import metaLogo from "../../assets/orgLogos/meta.png";
import microsoftLogo from "../../assets/orgLogos/microsoft.png";
import raveLogo from "../../assets/orgLogos/rave.png";
import yue2Logo from "../../assets/orgLogos/yue2.png";

// Real org/project marks (kwesi.docs/referenceImages), keyed by catalog
// modelId. MuseCoco and Museformer are both Microsoft Research, so they
// share one file — there's no separate per-model mark for either.
const LOGO_BY_MODEL_ID: Record<string, string> = {
  "ace-step-1.5": aceStepLogo,
  yue2: yue2Logo,
  musicgen: metaLogo,
  musecoco: microsoftLogo,
  museformer: microsoftLogo,
  rave: raveLogo,
};

/**
 * A real org logo in a fixed circular plate. The source marks are wildly
 * inconsistent on their own (some square with a baked-in black or white
 * background, one a wide transparent wordmark, some flush-transparent) —
 * `object-fit: contain` inside a shared plate is the one treatment that
 * never crops or distorts any of them, so the row reads as one coherent
 * set despite that. Falls back to a plain monogram for any model without
 * a sourced mark yet, rather than a broken image.
 */
export function OrgLogo({ modelId, org, size = 44 }: { modelId: string; org: string; size?: number }) {
  const src = LOGO_BY_MODEL_ID[modelId];
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-glass-sm"
    >
      {src ? (
        <img src={src} alt="" className="h-[72%] w-[72%] object-contain" />
      ) : (
        // The plate is a fixed white regardless of theme (see above), so
        // this needs a fixed dark text too -- text-ink would flip to
        // near-white in dark mode and vanish against it.
        <span className="text-xs font-semibold text-neutral-700">
          {org
            .split(/\s+/)
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </span>
      )}
    </div>
  );
}
