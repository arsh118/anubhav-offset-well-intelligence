type BrandLogoProps = {
  className: string
}

export function BrandLogo({ className }: BrandLogoProps) {
  return <img className={className} src="/assets/anubhav_logo.png" alt="ANUBHAV" draggable={false} />
}
