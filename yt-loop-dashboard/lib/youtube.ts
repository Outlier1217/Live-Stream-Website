import { google } from "googleapis";

export function getYoutubeClient(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.youtube({ version: "v3", auth: oauth2Client });
}

export async function createBroadcast(
  yt: any,
  { title, description, tags }: { title: string; description: string; tags: string[] }
) {
  const broadcast = await yt.liveBroadcasts.insert({
    part: ["snippet", "contentDetails", "status"],
    requestBody: {
      snippet: {
        title,
        description,
        scheduledStartTime: new Date().toISOString(),
      },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      contentDetails: { enableAutoStart: true, enableAutoStop: false },
    },
  });

  const stream = await yt.liveStreams.insert({
    part: ["snippet", "cdn"],
    requestBody: {
      snippet: { title },
      cdn: { frameRate: "variable", ingestionType: "rtmp", resolution: "variable" },
    },
  });

  await yt.liveBroadcasts.bind({
    id: broadcast.data.id,
    part: ["id"],
    streamId: stream.data.id,
  });

  // Set thumbnail
  // await yt.thumbnails.set({ videoId: broadcast.data.id, media: { body: thumbnailStream } });

  return {
    streamKey: stream.data.cdn.ingestionInfo.streamName,
    rtmpUrl: stream.data.cdn.ingestionInfo.ingestionAddress,
    broadcastId: broadcast.data.id,
  };
}