import { cx } from "@repo/utils";

const sizes = { sm: "size-8 text-caption", md: "size-10 text-body-small", lg: "size-14 text-h2" };

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** User avatar. Fixed dimensions prevent layout shift; falls back to initials without an image. */
export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft font-semibold text-brand-soft-text",
        sizes[size],
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- framework-agnostic package; avatars are small and fixed-size
        <img src={src} alt={name} loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <span role="img" aria-label={name}>
          {initials(name)}
        </span>
      )}
    </span>
  );
}
