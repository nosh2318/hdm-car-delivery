#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 5) { fprintf(stderr,"usage: add_audio VIDEO NARRATION MUSIC OUTPUT\n"); return 2; }
    NSURL *videoURL=[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
    NSURL *voiceURL=[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[2]]];
    NSURL *musicURL=[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[3]]];
    NSURL *outURL=[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[4]]];
    [[NSFileManager defaultManager] removeItemAtURL:outURL error:nil];
    AVMutableComposition *comp=[AVMutableComposition composition];
    AVURLAsset *va=[AVURLAsset URLAssetWithURL:videoURL options:nil];
    AVAssetTrack *sv=[[va tracksWithMediaType:AVMediaTypeVideo] firstObject];
    if(!sv){fprintf(stderr,"video track missing\n");return 1;}
    AVMutableCompositionTrack *tv=[comp addMutableTrackWithMediaType:AVMediaTypeVideo preferredTrackID:kCMPersistentTrackID_Invalid];
    [tv insertTimeRange:CMTimeRangeMake(kCMTimeZero,va.duration) ofTrack:sv atTime:kCMTimeZero error:nil]; tv.preferredTransform=sv.preferredTransform;
    NSArray *audioURLs=@[voiceURL,musicURL]; NSMutableArray *params=[NSMutableArray array];
    for(NSUInteger idx=0;idx<audioURLs.count;idx++){
      AVURLAsset *aa=[AVURLAsset URLAssetWithURL:audioURLs[idx] options:nil]; AVAssetTrack *sa=[[aa tracksWithMediaType:AVMediaTypeAudio] firstObject]; if(!sa)continue;
      AVMutableCompositionTrack *ta=[comp addMutableTrackWithMediaType:AVMediaTypeAudio preferredTrackID:kCMPersistentTrackID_Invalid];
      CMTime d=CMTimeMinimum(aa.duration,va.duration); [ta insertTimeRange:CMTimeRangeMake(kCMTimeZero,d) ofTrack:sa atTime:kCMTimeZero error:nil];
      AVMutableAudioMixInputParameters *p=[AVMutableAudioMixInputParameters audioMixInputParametersWithTrack:ta];
      [p setVolume:(idx==0?1.0:.34) atTime:kCMTimeZero]; [params addObject:p];
    }
    AVMutableAudioMix *mix=[AVMutableAudioMix audioMix]; mix.inputParameters=params;
    AVAssetExportSession *ex=[[AVAssetExportSession alloc] initWithAsset:comp presetName:AVAssetExportPresetHighestQuality];
    ex.outputURL=outURL; ex.outputFileType=AVFileTypeMPEG4; ex.audioMix=mix; ex.shouldOptimizeForNetworkUse=YES;
    dispatch_semaphore_t sem=dispatch_semaphore_create(0); [ex exportAsynchronouslyWithCompletionHandler:^{dispatch_semaphore_signal(sem);}]; dispatch_semaphore_wait(sem,DISPATCH_TIME_FOREVER);
    if(ex.status!=AVAssetExportSessionStatusCompleted){fprintf(stderr,"%s\n",ex.error.localizedDescription.UTF8String);return 1;}
    printf("%s\n",outURL.path.UTF8String);
  } return 0;
}
