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
 * A real org logo, filling a fixed circular plate edge to edge —
 * `object-fit: cover`, not `contain`, so there's no ring of visible
 * padding around it. Safe for every square mark here (ACE-Step, YuE2,
 * Meta, Microsoft) since cover on a square image in a square box never
 * crops anything. RAVE's real source asset is a wide 479x227 wordmark,
 * not a square mark — cover on that as-is would zoom in until it's
 * cropped to just "AV". Rather than special-case RAVE with a different
 * fit (inconsistent with the rest of the row) or leave it looking wrong,
 * its own file (src/assets/orgLogos/rave.png) has already been
 * pre-squared once, offline, onto a plain white canvas the same color as
 * the plate — so cover here is genuinely lossless for it too, not just
 * visually close. Falls back to a plain monogram for any model without a
 * sourced mark yet, rather than a broken image.
 */
export function OrgLogo({ modelId, org, size = 44 }: { modelId: string; org: string; size?: number }) {
  const src = LOGO_BY_MODEL_ID[modelId];
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-glass-sm"
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
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
