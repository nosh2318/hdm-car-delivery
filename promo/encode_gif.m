#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

int main(int argc,const char*argv[]){@autoreleasepool{
  if(argc<3)return 2;NSString*dir=[NSString stringWithUTF8String:argv[1]],*out=[NSString stringWithUTF8String:argv[2]];
  NSArray*all=[[NSFileManager defaultManager]contentsOfDirectoryAtPath:dir error:nil];NSArray*files=[[all filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSString*s,NSDictionary*_){return [s.pathExtension.lowercaseString isEqualToString:@"jpg"];}]]sortedArrayUsingSelector:@selector(compare:)];
  CGImageDestinationRef dst=CGImageDestinationCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:out],(__bridge CFStringRef)UTTypeGIF.identifier,files.count/2,NULL);
  NSDictionary*global=@{(NSString*)kCGImagePropertyGIFDictionary:@{(NSString*)kCGImagePropertyGIFLoopCount:@0}};CGImageDestinationSetProperties(dst,(__bridge CFDictionaryRef)global);
  NSDictionary*frame=@{(NSString*)kCGImagePropertyGIFDictionary:@{(NSString*)kCGImagePropertyGIFDelayTime:@(1.0/12.0)}};
  for(NSUInteger i=0;i<files.count;i+=2){NSImage*src=[[NSImage alloc]initWithContentsOfFile:[dir stringByAppendingPathComponent:files[i]]],*small=[[NSImage alloc]initWithSize:NSMakeSize(540,960)];[small lockFocus];[src drawInRect:NSMakeRect(0,0,540,960) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1];[small unlockFocus];CGImageRef cg=[small CGImageForProposedRect:NULL context:nil hints:nil];CGImageDestinationAddImage(dst,cg,(__bridge CFDictionaryRef)frame);if(i%96==0)printf("gif %lu/%lu\n",(unsigned long)i,(unsigned long)files.count);}
  BOOL ok=CGImageDestinationFinalize(dst);CFRelease(dst);return ok?0:1;
}}
