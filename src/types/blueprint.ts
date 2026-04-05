/**
 * Site Blueprint — the universal intermediate format.
 * All three modes (rebuild, clone, generate) produce a Blueprint.
 * Claude consumes a Blueprint to generate the final static site.
 */

export type GenerationMode = 'rebuild' | 'clone' | 'generate'

export interface SiteBlueprint {
  mode: GenerationMode
  meta: SiteMeta
  design: DesignTokens
  pages: PageBlueprint[]
  navigation: NavItem[]
  assets: AssetRef[]
  ecommerce?: EcommerceConfig
  forms?: FormConfig[]
}

/** High-level site identity */
export interface SiteMeta {
  businessName: string
  tagline?: string
  industry?: string
  description: string
  logoUrl?: string
  faviconUrl?: string
  contactEmail?: string
  contactPhone?: string
  address?: string
  socialLinks?: Record<string, string>
}

/** Visual identity extracted or specified */
export interface DesignTokens {
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    surface: string
    text: string
    textMuted: string
  }
  fonts: {
    heading: string
    body: string
  }
  borderRadius: string
  style: 'modern' | 'classic' | 'minimal' | 'bold' | 'playful'
}

/** One page in the site */
export interface PageBlueprint {
  slug: string
  title: string
  pageType: 'homepage' | 'about' | 'services' | 'service-detail' | 'products' | 'product-detail' | 'contact' | 'blog' | 'blog-post' | 'faq' | 'gallery' | 'generic'
  sections: SectionBlueprint[]
  seo: PageSEO
  schema: SchemaSpec[]
}

/** Content section within a page */
export interface SectionBlueprint {
  type: 'hero' | 'text' | 'features' | 'services' | 'products' | 'testimonials' | 'faq' | 'cta' | 'gallery' | 'team' | 'pricing' | 'contact-form' | 'map' | 'stats' | 'logo-bar' | 'footer' | 'custom'
  heading?: string
  content?: string
  items?: SectionItem[]
  image?: string
  layout?: 'left-right' | 'right-left' | 'centered' | 'grid' | 'cards'
}

export interface SectionItem {
  title?: string
  description?: string
  image?: string
  price?: string
  link?: string
  icon?: string
  rating?: number
  author?: string
}

/** SEO metadata for a page */
export interface PageSEO {
  title: string
  description: string
  ogImage?: string
  canonical?: string
}

/** Schema.org spec for a page */
export interface SchemaSpec {
  type: string
  fields: Record<string, unknown>
}

/** Navigation structure */
export interface NavItem {
  label: string
  href: string
  children?: NavItem[]
}

/** Referenced asset (image, font, etc.) */
export interface AssetRef {
  originalUrl: string
  localPath: string
  type: 'image' | 'font' | 'icon' | 'other'
}

/** E-commerce configuration */
export interface EcommerceConfig {
  provider: 'snipcart' | 'stripe' | 'shopify-buy' | 'none'
  apiKey?: string
  products: ProductSpec[]
}

export interface ProductSpec {
  id: string
  name: string
  description: string
  price: number
  currency: string
  image?: string
  variants?: { name: string; options: string[] }[]
}

/** Form handling */
export interface FormConfig {
  id: string
  name: string
  provider: 'formspree' | 'netlify' | 'mailto' | 'custom'
  endpoint?: string
  fields: { name: string; type: string; required: boolean; label: string }[]
}

/** CLI input for each mode */
export interface RebuildInput {
  mode: 'rebuild'
  url: string
  auditorApiKey?: string
}

export interface CloneInput {
  mode: 'clone'
  inspirationUrl: string
  clientContent: SiteMeta & {
    pages?: Partial<PageBlueprint>[]
  }
}

export interface GenerateInput {
  mode: 'generate'
  brief: string
  clientContent: SiteMeta & {
    pages?: Partial<PageBlueprint>[]
  }
  stylePreference?: DesignTokens['style']
}

export type GeneratorInput = RebuildInput | CloneInput | GenerateInput
