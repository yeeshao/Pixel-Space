import { computed, type Ref } from 'vue';

import type { GeocodeRegion } from './geocode.api';
import type { ImageRecord } from './image.types';
import { buildImageLinkRows, buildPublicPageUrl } from './image-links';
import { formatDateTime, paletteFromImage, parseDominantColor, tagsFromImage } from './image-meta';
import {
  regionFromSearchRegion,
  toMapCoordinate,
  toRegion,
  type ImageLightboxEditForm,
} from './useImageLightboxEditForm';

interface UseImageLightboxDetailsOptions {
  image: Readonly<Ref<ImageRecord | null | undefined>>;
  origin: string;
  locationEditOpen: Readonly<Ref<boolean>>;
  editSearchRegion: Readonly<Ref<GeocodeRegion>>;
  editForm: ImageLightboxEditForm;
  adminOriginal?: boolean;
}

export const originalImageUrl = (image: ImageRecord) => `/api/image/${encodeURIComponent(image.key)}/original`;

export const useImageLightboxDetails = ({
  image,
  origin,
  locationEditOpen,
  editSearchRegion,
  editForm,
  adminOriginal = false,
}: UseImageLightboxDetailsOptions) => {
  const publicPageUrl = computed(() => {
    if (!image.value) return '';
    return buildPublicPageUrl(image.value, origin);
  });

  const originalUrl = computed(() => {
    if (!image.value) return '';
    if (adminOriginal) {
      const encodedKey = image.value.key
        .replace(/^\/+/, '')
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('%2F');
      return `/api/admin/original/${encodedKey}`;
    }
    return originalImageUrl(image.value);
  });

  const downloadOriginalUrl = computed(() => {
    if (!image.value) return '';
    if (adminOriginal) return originalUrl.value;
    return originalUrl.value
      ? `${originalUrl.value}${originalUrl.value.includes('?') ? '&' : '?'}download=1`
      : '';
  });

  const linkRows = computed(() => {
    if (!image.value) return [];
    return buildImageLinkRows(image.value, origin);
  });

  const formatExifTakenAt = (value: string | null | undefined): string =>
    formatDateTime(value);
  const formatImageTimestamp = (value: string | null | undefined): string =>
    formatDateTime(value);

  const exifRows = computed(() => {
    const record = image.value;
    if (!record) return [];
    return [
      { label: '拍摄时间', value: formatExifTakenAt(record.exif_taken_at), muted: !record.exif_taken_at, span: 'full' },
      { label: '相机', value: record.exif_camera || '未记录', muted: !record.exif_camera, span: 'full' },
      {
        label: 'ISO',
        value: record.exif_iso === null ? '未记录' : `ISO ${record.exif_iso}`,
        muted: record.exif_iso === null,
        span: 'half',
      },
      {
        label: '光圈',
        value: record.exif_aperture === null ? '未记录' : `f/${record.exif_aperture}`,
        muted: record.exif_aperture === null,
        span: 'half',
      },
      { label: '快门', value: record.exif_shutter || '未记录', muted: !record.exif_shutter, span: 'half' },
      {
        label: '焦距',
        value: record.exif_focal_length === null ? '未记录' : `${record.exif_focal_length} mm`,
        muted: record.exif_focal_length === null,
        span: 'half',
      },
    ];
  });

  const aiTags = computed(() => tagsFromImage(image.value));
  const aiPalette = computed(() => paletteFromImage(image.value));
  const dominantColor = computed(() => parseDominantColor(image.value?.dominant_color));

  const hasCoordinates = computed(
    () => image.value?.location_lat != null && image.value?.location_lng != null,
  );

  const mapLat = computed(() => toMapCoordinate(
    locationEditOpen.value ? editForm.location_lat : image.value?.location_lat,
  ));

  const mapLng = computed(() => toMapCoordinate(
    locationEditOpen.value ? editForm.location_lng : image.value?.location_lng,
  ));

  const mapRegion = computed(() =>
    locationEditOpen.value ? regionFromSearchRegion(editSearchRegion.value) : toRegion(image.value?.location_region),
  );

  return {
    publicPageUrl,
    originalUrl,
    downloadOriginalUrl,
    linkRows,
    formatExifTakenAt,
    formatImageTimestamp,
    exifRows,
    aiTags,
    aiPalette,
    dominantColor,
    hasCoordinates,
    mapLat,
    mapLng,
    mapRegion,
  };
};

