export function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark${small ? " small" : ""}`} aria-hidden="true">S</span>;
}

export function BrandName() {
  return <span>Sakuna<span className="brand-ai"> AI</span></span>;
}
