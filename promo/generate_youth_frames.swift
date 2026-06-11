import AppKit
import Foundation

let W: CGFloat = 1080, H: CGFloat = 1920, fps = 24, duration = 29
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("promo")
let out = root.appendingPathComponent("frames_short_youth")
try? FileManager.default.removeItem(at: out)
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

let paths = [
  "phone": "assets/youth/01_phone_friends.png", "handover": "assets/youth/02_key_handover.png",
  "drive": "assets/youth/03_city_drive.png", "trip": "assets/youth/04_roadtrip.png",
  "logo": "../images/logo_header.png", "m1": "assets/mobile_map.png",
  "m2": "assets/mobile_cars.png", "m3": "assets/mobile_confirm.png"
]
var images: [String:NSImage] = [:]
for (k,p) in paths { images[k] = NSImage(contentsOf: root.appendingPathComponent(p))! }

func clamp(_ x: Double) -> CGFloat { CGFloat(max(0, min(1, x))) }
func ease(_ x: Double) -> CGFloat { let q = clamp(x); return 1 - pow(1-q, 3) }
func alpha(_ t: Double, _ a: Double, _ b: Double, _ f: Double = 0.38) -> CGFloat { clamp((t-a)/f) * clamp((b-t)/f) }
func topRect(_ x: CGFloat,_ y: CGFloat,_ w: CGFloat,_ h: CGFloat) -> NSRect { NSRect(x:x,y:H-y-h,width:w,height:h) }
func color(_ hex: Int, _ a: CGFloat = 1) -> NSColor { NSColor(calibratedRed: CGFloat((hex>>16)&255)/255, green: CGFloat((hex>>8)&255)/255, blue: CGFloat(hex&255)/255, alpha:a) }
let yellow=color(0xFABE00), blue=color(0x38AEF5), coral=color(0xFF685C), ink=color(0x111827), white=NSColor.white

func fill(_ c: NSColor,_ a: CGFloat = 1) { c.withAlphaComponent(a).setFill(); NSBezierPath(rect:NSRect(x:0,y:0,width:W,height:H)).fill() }
func roundRect(_ r:NSRect,_ radius:CGFloat,_ c:NSColor,_ a:CGFloat=1) { c.withAlphaComponent(a).setFill(); NSBezierPath(roundedRect:r,xRadius:radius,yRadius:radius).fill() }
func cover(_ img:NSImage,_ rect:NSRect,_ zoom:CGFloat=1,_ ox:CGFloat=0.5,_ oy:CGFloat=0.5,_ a:CGFloat=1) {
  let s=img.size, scale=max(rect.width/s.width,rect.height/s.height)*zoom
  let sw=rect.width/scale, sh=rect.height/scale
  let src=NSRect(x:(s.width-sw)*ox,y:(s.height-sh)*oy,width:sw,height:sh)
  img.draw(in:rect,from:src,operation:.sourceOver,fraction:a,respectFlipped:false,hints:[.interpolation:NSImageInterpolation.high])
}
func text(_ s:String,_ x:CGFloat,_ y:CGFloat,_ size:CGFloat,_ weight:NSFont.Weight = .bold,_ c:NSColor=white,_ align:NSTextAlignment = .left,_ width:CGFloat=960,_ a:CGFloat=1) {
  let p=NSMutableParagraphStyle(); p.alignment=align
  let attrs:[NSAttributedString.Key:Any]=[.font:NSFont.systemFont(ofSize:size,weight:weight),.foregroundColor:c.withAlphaComponent(a),.paragraphStyle:p]
  s.draw(in:topRect(x,y,width,size*1.35),withAttributes:attrs)
}
func pill(_ s:String,_ x:CGFloat,_ y:CGFloat,_ w:CGFloat,_ bg:NSColor,_ fg:NSColor,_ a:CGFloat) {
  roundRect(topRect(x,y,w,76),38,bg,a); text(s,x,y+18,29,.heavy,fg,.center,w,a)
}
func shade(_ a:CGFloat) {
  let g=NSGradient(colors:[NSColor.black.withAlphaComponent(.86*a),NSColor.black.withAlphaComponent(0)])!
  g.draw(in:topRect(0,0,W,850),angle:-90)
}
func photo(_ key:String,_ t:Double,_ a:Double,_ b:Double,_ title:String,_ sub:String,_ tag:String,_ tagColor:NSColor,_ ox:CGFloat=0.5) {
  let A=alpha(t,a,b), p=ease((t-a)/(b-a)); if A <= 0 { return }
  cover(images[key]!,topRect(-30*p,0,W+60*p,H),1.04+0.04*p,ox,0.5,A); shade(A)
  text(title,64,155,75,.heavy,white,.left,950,A); text(sub,67,253,35,.bold,yellow,.left,930,A)
  yellow.withAlphaComponent(A).setFill(); NSBezierPath(rect:topRect(67,325,250*ease((t-a-.25)/.7),11)).fill()
  pill(tag,65,390,250,tagColor,tagColor == yellow ? ink : white,A*ease((t-a-.5)/.45))
}
func confetti(_ t:Double,_ A:CGFloat) {
  let cs=[yellow,blue,coral,white]
  for i in 0..<16 { let x=CGFloat((i*173+93)%1080), y=CGFloat((i*257+120+Int(t*75))%1920); cs[i%4].withAlphaComponent(.72*A).setFill(); NSBezierPath(roundedRect:topRect(x,y,15,42),xRadius:7,yRadius:7).fill() }
}

for frame in 0..<(fps*duration) {
  autoreleasepool {
    let t=Double(frame)/Double(fps), canvas=NSImage(size:NSSize(width:W,height:H))
    canvas.lockFocus(); ink.setFill(); NSBezierPath(rect:NSRect(x:0,y:0,width:W,height:H)).fill()

    let ia=alpha(t,0,3.3); if ia>0 { fill(color(0xEAF8FF),ia); confetti(t,ia); roundRect(topRect(75,590,930,240),55,ink,ia*ease(t/.5)); text("クルマ、取りに行く？",75,650,63,.heavy,white,.center,930,ia*ease(t/.5)); roundRect(topRect(135,930,810,240),55,yellow,ia*ease((t-.65)/.5)); text("届けてもらお。",135,990,79,.heavy,ink,.center,810,ia*ease((t-.65)/.5)); pill("CAR DELIVERY",330,1280,420,blue,white,ia*ease((t-1.35)/.5)) }
    photo("phone",t,2.7,6.8,"集合場所をタップ。","ホテルでも、街でも。","01  PLACE",yellow,0.52)
    photo("handover",t,6.2,10.8,"クルマが来る。","受け取ったら、即スタート。","02  KEY",coral,0.56)
    photo("drive",t,10.2,14.9,"予定より、自由。","街から旅が始まる。","03  DRIVE",blue,0.58)
    photo("trip",t,14.3,19.0,"行きたい場所が、","今日の目的地。","GOOD DAY!",yellow,0.50)

    let ma=alpha(t,18.4,25.3); if ma>0 { fill(color(0xEAF8FF),ma); confetti(t*.35,ma); text("スマホで、サクッと。",60,80,62,.heavy,ink,.center,960,ma); text("場所 → 車 → 予約",60,160,33,.heavy,blue,.center,960,ma); let cards=[("m1",18.6,"1  場所を選ぶ"),("m2",20.45,"2  車を選ぶ"),("m3",22.3,"3  予約を確認")]; for (k,d,label) in cards { let A=ma*alpha(t,d,d+2.55,.35); if A>0 { let p=ease((t-d)/.5), r=topRect(195,300+90*(1-p),690,1490); roundRect(r,55,white,A); cover(images[k]!,r,1,0.5,0.06,A); roundRect(topRect(300,340,480,82),41,ink,A); text(label,300,360,31,.heavy,white,.center,480,A) } } }

    let ea=alpha(t,24.7,30,.6); if ea>0 { fill(white,ea); confetti(t*.6,ea); yellow.withAlphaComponent(ea).setFill(); NSBezierPath(rect:topRect(0,0,W,24)).fill(); blue.withAlphaComponent(ea).setFill(); NSBezierPath(rect:topRect(0,H-24,W,24)).fill(); let p=ease((t-25)/.7); images["logo"]!.draw(in:topRect(140,440+45*(1-p),800,109),from:.zero,operation:.sourceOver,fraction:ea*p); text("スマートに借りて、",60,790,69,.heavy,ink,.center,960,ea*p); text("自由に走ろう",60,890,78,.heavy,ink,.center,960,ea*p); pill("YOUR TRIP. YOUR WAY.",270,1055,540,yellow,ink,ea*p); text("SAPPORO CAR DELIVERY SERVICE",60,1270,23,.heavy,color(0x64748B),.center,960,ea*p) }

    canvas.unlockFocus()
    let rep=NSBitmapImageRep(data:canvas.tiffRepresentation!)!, data=rep.representation(using:.jpeg,properties:[.compressionFactor:0.91])!
    try! data.write(to:out.appendingPathComponent(String(format:"frame_%05d.jpg",frame)))
    if frame % 48 == 0 { print("rendered \(frame)/\(fps*duration)") }
  }
}
print(out.path)
