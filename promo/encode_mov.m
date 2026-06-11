#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>

static CVPixelBufferRef PixelBufferFromImage(NSImage *image, size_t width, size_t height) {
  NSDictionary *attrs = @{(id)kCVPixelBufferCGImageCompatibilityKey:@YES,
                          (id)kCVPixelBufferCGBitmapContextCompatibilityKey:@YES};
  CVPixelBufferRef pb = NULL;
  CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32ARGB,
                      (__bridge CFDictionaryRef)attrs, &pb);
  CVPixelBufferLockBaseAddress(pb, 0);
  CGContextRef ctx = CGBitmapContextCreate(CVPixelBufferGetBaseAddress(pb), width, height, 8,
                                           CVPixelBufferGetBytesPerRow(pb), CGColorSpaceCreateDeviceRGB(),
                                           kCGImageAlphaNoneSkipFirst);
  CGImageRef cg = [image CGImageForProposedRect:NULL context:nil hints:nil];
  CGContextDrawImage(ctx, CGRectMake(0, 0, width, height), cg);
  CGContextRelease(ctx);
  CVPixelBufferUnlockBaseAddress(pb, 0);
  return pb;
}

int main(int argc, const char * argv[]) {
  @autoreleasepool {
    if (argc < 3) { fprintf(stderr, "usage: encode FRAMES_DIR OUTPUT.mp4\n"); return 2; }
    NSString *dir = [NSString stringWithUTF8String:argv[1]];
    NSURL *out = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[2]]];
    [[NSFileManager defaultManager] removeItemAtURL:out error:nil];
    NSArray *all = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:dir error:nil];
    NSArray *files = [[all filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSString *s, NSDictionary *_) {
      return [s.pathExtension.lowercaseString isEqualToString:@"jpg"];
    }]] sortedArrayUsingSelector:@selector(compare:)];

    int width = 1280, height = 720;
    NSImage *first = [[NSImage alloc] initWithContentsOfFile:[dir stringByAppendingPathComponent:files.firstObject]];
    if (first) { width = (int)first.size.width; height = (int)first.size.height; }
    NSError *err = nil;
    AVAssetWriter *writer = [AVAssetWriter assetWriterWithURL:out fileType:AVFileTypeQuickTimeMovie error:&err];
    NSDictionary *settings = @{AVVideoCodecKey:AVVideoCodecTypeJPEG, AVVideoWidthKey:@(width), AVVideoHeightKey:@(height),
      AVVideoCompressionPropertiesKey:@{AVVideoQualityKey:@0.72}};
    AVAssetWriterInput *input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:settings];
    input.expectsMediaDataInRealTime = NO;
    NSDictionary *pbAttrs = @{(id)kCVPixelBufferPixelFormatTypeKey:@(kCVPixelFormatType_32ARGB),
      (id)kCVPixelBufferWidthKey:@(width),(id)kCVPixelBufferHeightKey:@(height)};
    AVAssetWriterInputPixelBufferAdaptor *adaptor = [AVAssetWriterInputPixelBufferAdaptor assetWriterInputPixelBufferAdaptorWithAssetWriterInput:input sourcePixelBufferAttributes:pbAttrs];
    [writer addInput:input]; [writer startWriting]; [writer startSessionAtSourceTime:kCMTimeZero];
    int fps=24, i=0;
    for (NSString *name in files) {
      while (!input.readyForMoreMediaData) [NSThread sleepForTimeInterval:.002];
      NSImage *image = [[NSImage alloc] initWithContentsOfFile:[dir stringByAppendingPathComponent:name]];
      CVPixelBufferRef pb = PixelBufferFromImage(image, width, height);
      [adaptor appendPixelBuffer:pb withPresentationTime:CMTimeMake(i, fps)];
      CVPixelBufferRelease(pb);
      if (i % 48 == 0) printf("encoded %d/%lu\n", i, (unsigned long)files.count);
      i++;
    }
    [input markAsFinished];
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    [writer finishWritingWithCompletionHandler:^{ dispatch_semaphore_signal(sem); }];
    dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
    if (writer.status != AVAssetWriterStatusCompleted) { fprintf(stderr, "%s\n", writer.error.localizedDescription.UTF8String); return 1; }
    printf("%s\n", out.path.UTF8String);
  }
  return 0;
}
