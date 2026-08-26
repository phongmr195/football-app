"use client";

import { useEffect, useRef } from "react";

const YOUTUBE_ID_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function parseYouTubeVideoId(url: string): string | null {
  return url.match(YOUTUBE_ID_RE)?.[1] ?? null;
}

/** Nhúng link admin nhập cho match đang LIVE — YouTube (watch/embed/live/youtu.be) render qua
 * iframe, còn lại coi là HLS (.m3u8) render qua <video> + hls.js (Safari phát HLS native, không
 * cần hls.js). */
export function LiveStreamPlayer({ url }: { url: string }) {
  const videoId = parseYouTubeVideoId(url);

  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
      {videoId ? (
        <iframe
          // controls=0/disablekb=1: component chỉ render khi match đang LIVE thật (xem
          // LiveMatchPanel) — không cho tua tới xem trước. YouTube không có param ẩn riêng seek
          // bar, phải ẩn toàn bộ control native.
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&disablekb=1&modestbranding=1`}
          title="Live stream"
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <HlsPlayer url={url} />
      )}
    </div>
  );
}

function HlsPlayer({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      return;
    }

    let hls: import("hls.js").default | undefined;
    let cancelled = false;
    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) return;
      hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
    });

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [url]);

  // Không có `controls` (cùng lý do controls=0 ở nhánh YouTube) — native seek bar không tách
  // riêng được khỏi các control khác.
  return <video ref={videoRef} autoPlay muted playsInline className="h-full w-full" />;
}
