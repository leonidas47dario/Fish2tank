/**
 * Every icon in the app, from one family, at one weight.
 *
 * The shipped build drew its navigation with typed characters - `⌂ ◈ ◉ ▤ ✎` -
 * which is not a decision about iconography so much as the absence of one.
 * Those five codepoints render at a different weight, size and baseline in
 * every system font, several have no glyph at all on Android, and two of them
 * (`◈`, `◉`) mean nothing to anyone.
 *
 * Phosphor, imported one module at a time rather than from the barrel: the
 * barrel is ~1,500 modules and makes a dev server crawl, and while Rollup
 * tree-shakes it in a production build there is no reason to hand it the
 * problem.
 *
 * Re-exported through here rather than imported directly at each call site so
 * that "one family, one weight" is a fact about a file instead of a convention
 * somebody has to remember. Swapping the family is an edit to this module.
 */
export { HouseIcon } from '@phosphor-icons/react/dist/csr/House';
export { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour';
export { CameraIcon } from '@phosphor-icons/react/dist/csr/Camera';
export { DropIcon } from '@phosphor-icons/react/dist/csr/Drop';
export { NotePencilIcon } from '@phosphor-icons/react/dist/csr/NotePencil';
export { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
export { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
export { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
export { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
export { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
export { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
export { WifiSlashIcon } from '@phosphor-icons/react/dist/csr/WifiSlash';
export { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
export { ClockIcon } from '@phosphor-icons/react/dist/csr/Clock';
export { FishIcon } from '@phosphor-icons/react/dist/csr/Fish';
export { LockIcon } from '@phosphor-icons/react/dist/csr/Lock';
export { ImageBrokenIcon } from '@phosphor-icons/react/dist/csr/ImageBroken';
export { GearIcon } from '@phosphor-icons/react/dist/csr/Gear';
export { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
export { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
export { XIcon } from '@phosphor-icons/react/dist/csr/X';
export { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';

/**
 * The one stroke weight, everywhere.
 *
 * Phosphor's `regular` is 16/256 units; at the 18-22px this app draws icons,
 * `bold` reads as a different icon set rather than the same one emphasised.
 */
export const ICON_WEIGHT = 'regular' as const;
