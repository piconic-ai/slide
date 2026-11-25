import type { PngShape } from '../profile/picture-png'

/** The two pictures a community may put up. */
export const COMMUNITY_IMAGES = ['logo', 'cover'] as const
export type CommunityImage = (typeof COMMUNITY_IMAGES)[number]

/**
 * How each picture is chosen, shrunk in the browser and kept (D-47, D-48):
 * the largest file the browser reads, the side it draws (the width, for the
 * cover), its shape (width over height), and what the service keeps. The
 * cover is never drawn wider than the picture was.
 */
export const IMAGE_RULES = {
  logo: {
    maxBytes: 1024 * 1024,
    side: 256,
    aspect: 1,
    noUpscale: false,
    png: {
      // A 256 by 256 RGBA picture written without compression, and room.
      maxBytes: 512 * 1024,
      fits: (width: number, height: number) => width === 256 && height === 256,
    },
  },
  cover: {
    maxBytes: 2 * 1024 * 1024,
    side: 1600,
    aspect: 4,
    noUpscale: true,
    png: {
      // A 1600 by 400 RGBA picture written without compression is 2.5 MB.
      maxBytes: 4 * 1024 * 1024,
      fits: (width: number, height: number) =>
        width >= 1 &&
        width <= 1600 &&
        height === Math.max(1, Math.round(width / 4)),
    },
  },
} as const satisfies Record<
  CommunityImage,
  Readonly<{
    maxBytes: number
    side: number
    aspect: number
    noUpscale: boolean
    png: PngShape
  }>
>

/** No side of a chosen picture may be longer than this, in pixels. */
export const IMAGE_MAX_SIDE = 8192

/** Where a community's picture lives in R2. */
export const imageKey = (communityId: number, image: CommunityImage) =>
  `communities/${communityId}/${image}`

export const isCommunityImage = (value: string): value is CommunityImage =>
  (COMMUNITY_IMAGES as readonly string[]).includes(value)
