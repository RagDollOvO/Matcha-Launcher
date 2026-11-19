// Extracted from regoists/Skeeto 7a18b4988d089fdf6cc7e857560cf82a9609a32c. GPL-3.0.
// Original geometry and 20 factory presets; host globals replaced with thread-owned state.
static constexpr int kXhairStyleCount=20;
struct XhairTune {
	int color, size, length, gap, thick, dot, outline, alpha;
};
static const XhairTune kXhairFactory[kXhairStyleCount] = {
	{ 2, 100, 8, 4, 2, 0, 1, 100 }, // 十字
	{ 2, 100, 8, 4, 2, 3, 1, 100 }, // 十字+点
	{ 2, 100, 8, 0, 2, 4, 1, 100 }, // 点
	{ 2, 100, 7, 0, 2, 0, 1, 100 }, // 圆环
	{ 2, 100, 7, 0, 2, 3, 1, 100 }, // 圆环+点
	{ 2, 100, 7, 3, 2, 0, 1, 100 }, // 圆环+十字
	{ 2, 100, 8, 4, 2, 0, 1, 100 }, // T字
	{ 2, 100, 8, 4, 2, 3, 1, 100 }, // T字+点
	{ 2, 100, 6, 2, 2, 0, 1, 100 }, // 方框
	{ 2, 100, 6, 2, 2, 3, 1, 100 }, // 方框+点
	{ 2, 100, 7, 0, 2, 0, 1, 100 }, // 菱形
	{ 2, 100, 8, 2, 2, 0, 1, 100 }, // 人字
	{ 2, 100, 5, 6, 2, 0, 1, 100 }, // 四角
	{ 2, 100, 8, 3, 2, 0, 1, 100 }, // 双环
	{ 2, 100, 10, 4, 2, 0, 1, 100 }, // 横线
	{ 2, 100, 8, 0, 2, 0, 1, 100 }, // 三角
	{ 2, 100, 8, 4, 2, 0, 1, 100 }, // X字形
	{ 2, 100, 8, 4, 2, 3, 1, 100 }, // X字形+点
	{ 2, 100, 8, 3, 2, 0, 1, 100 }, // X字形+圆环
	{ 2, 100, 8, 3, 2, 3, 1, 100 }, // X字形+圆环+点
};

static XhairTune g_xhairCurrent{};
static const XhairTune& XhairT(){return g_xhairCurrent;}
static float XhairHudMul(){return (float(g_xhairDrawH)/1080.f)*(float(XhairT().size)/100.f);}
static float XhairScaleF(int logical, float minv) {
	float x = (float)logical * XhairHudMul();
	if (x < minv) x = minv;
	return x;
}

static int XhairWantWin() {
	const XhairTune& t = XhairT();
	const float length = XhairScaleF(t.length, 1.f);
	const float gap = (t.gap <= 0) ? 0.f : XhairScaleF(t.gap, 0.f);
	const float thick = XhairScaleF(t.thick, 1.f);
	const float outline = (t.outline <= 0) ? 0.f : XhairScaleF(t.outline, 1.f);
	const float dot = (t.dot <= 0) ? 0.f : XhairScaleF(t.dot, 1.f);
	// Circle/diamond radius is length+gap+thick; keep padding for AA + outline.
	float reach = length + gap + thick * 2.f + outline * 2.f + dot + 16.f;
	if (reach < 28.f) reach = 28.f;
	int win = (int)ceilf(reach * 2.f + 8.f);
	if (win > 512) win = 512;
	if (win < 32) win = 32;
	return win;
}

static Gdiplus::Color XhairArgb(COLORREF c, BYTE a) {
	return Gdiplus::Color(a, GetRValue(c), GetGValue(c), GetBValue(c));
}

static void XhairStrokeLine(Gdiplus::Graphics& g, float x1, float y1, float x2, float y2,
	float thick, const Gdiplus::Color& col) {
	if (thick <= 0.f) return;
	Gdiplus::Pen pen(col, thick);
	pen.SetLineCap(Gdiplus::LineCapFlat, Gdiplus::LineCapFlat, Gdiplus::DashCapFlat);
	pen.SetLineJoin(Gdiplus::LineJoinRound);
	g.DrawLine(&pen, x1, y1, x2, y2);
}

static void XhairArmAA(Gdiplus::Graphics& g, float cx, float cy, float dirX, float dirY,
	float length, float thick, float gap, const Gdiplus::Color& col, float outline,
	const Gdiplus::Color& oc) {
	if (length <= 0.f || thick <= 0.f) return;
	float x1, y1, x2, y2;
	if (dirY == 0.f) {
		y1 = y2 = cy;
		if (dirX > 0.f) { x1 = cx + gap; x2 = cx + gap + length; }
		else { x1 = cx - gap; x2 = cx - gap - length; }
	} else {
		x1 = x2 = cx;
		if (dirY > 0.f) { y1 = cy + gap; y2 = cy + gap + length; }
		else { y1 = cy - gap; y2 = cy - gap - length; }
	}
	if (outline > 0.f)
		XhairStrokeLine(g, x1, y1, x2, y2, thick + outline * 2.f, oc);
	XhairStrokeLine(g, x1, y1, x2, y2, thick, col);
}

static void XhairDotAA(Gdiplus::Graphics& g, float cx, float cy, float sz,
	const Gdiplus::Color& col, float outline, const Gdiplus::Color& oc) {
	if (sz <= 0.f) return;
	const float x = cx - sz * 0.5f;
	const float y = cy - sz * 0.5f;
	if (outline > 0.f) {
		Gdiplus::SolidBrush ob(oc);
		g.FillEllipse(&ob, x - outline, y - outline, sz + outline * 2.f, sz + outline * 2.f);
	}
	Gdiplus::SolidBrush br(col);
	g.FillEllipse(&br, x, y, sz, sz);
}

static void XhairCircleAA(Gdiplus::Graphics& g, float cx, float cy, float radius, float thick,
	const Gdiplus::Color& col, float outline, const Gdiplus::Color& oc) {
	if (radius <= 0.f || thick <= 0.f) return;
	const float x = cx - radius;
	const float y = cy - radius;
	const float d = radius * 2.f;
	if (outline > 0.f) {
		Gdiplus::Pen op(oc, thick + outline * 2.f);
		g.DrawEllipse(&op, x, y, d, d);
	}
	Gdiplus::Pen pen(col, thick);
	g.DrawEllipse(&pen, x, y, d, d);
}

static void XhairRectAA(Gdiplus::Graphics& g, float l, float t, float w, float h, float thick,
	const Gdiplus::Color& col, float outline, const Gdiplus::Color& oc) {
	if (thick <= 0.f) return;
	if (outline > 0.f) {
		Gdiplus::Pen op(oc, thick + outline * 2.f);
		g.DrawRectangle(&op, l, t, w, h);
	}
	Gdiplus::Pen pen(col, thick);
	g.DrawRectangle(&pen, l, t, w, h);
}

static void XhairDrawAll(Gdiplus::Graphics& g, float cx, float cy) {
	const XhairTune& t = XhairT();
	int a = (t.alpha * 255) / 100;
	if (a < 16) a = 16;
	if (a > 255) a = 255;
	const COLORREF cr = kXhairColorRgb[(t.color >= 0 && t.color < kXhairColorCount) ? t.color : 2];
	const Gdiplus::Color col = XhairArgb(cr, (BYTE)a);
	const Gdiplus::Color oc = XhairArgb(RGB(0, 0, 0), (BYTE)a);
	const float length = XhairScaleF(t.length, 1.f);
	const float gap = (t.gap <= 0) ? 0.f : XhairScaleF(t.gap, 0.f);
	const float thick = XhairScaleF(t.thick, 1.f);
	const float outline = (t.outline <= 0) ? 0.f : XhairScaleF(t.outline, 1.f);
	float dot = (t.dot <= 0) ? 0.f : XhairScaleF(t.dot, 1.f);
	const int style = g_xhairStyle;

	auto cross = [&]() {
		XhairArmAA(g, cx, cy, 1.f, 0.f, length, thick, gap, col, outline, oc);
		XhairArmAA(g, cx, cy, -1.f, 0.f, length, thick, gap, col, outline, oc);
		XhairArmAA(g, cx, cy, 0.f, 1.f, length, thick, gap, col, outline, oc);
		XhairArmAA(g, cx, cy, 0.f, -1.f, length, thick, gap, col, outline, oc);
	};
	auto tee = [&]() {
		XhairArmAA(g, cx, cy, 1.f, 0.f, length, thick, gap, col, outline, oc);
		XhairArmAA(g, cx, cy, -1.f, 0.f, length, thick, gap, col, outline, oc);
		XhairArmAA(g, cx, cy, 0.f, 1.f, length, thick, gap, col, outline, oc);
	};
	auto xCross = [&]() {
		const float diag = 0.70710678f;
		auto arm = [&](float dx, float dy) {
			const float x1 = cx + dx * gap * diag;
			const float y1 = cy + dy * gap * diag;
			const float x2 = cx + dx * (gap + length) * diag;
			const float y2 = cy + dy * (gap + length) * diag;
			if (outline > 0.f)
				XhairStrokeLine(g, x1, y1, x2, y2, thick + outline * 2.f, oc);
			XhairStrokeLine(g, x1, y1, x2, y2, thick, col);
		};
		arm(-1.f, -1.f);
		arm(1.f, -1.f);
		arm(-1.f, 1.f);
		arm(1.f, 1.f);
	};
	auto maybeDot = [&]() {
		if (dot > 0.f)
			XhairDotAA(g, cx, cy, dot, col, outline, oc);
	};

	switch (style) {
	case 0: // 十字
		cross();
		maybeDot();
		break;
	case 1: // 十字+点
		cross();
		maybeDot();
		break;
	case 2: // 点
		if (dot <= 0.f) dot = XhairScaleF(4, 1.f);
		XhairDotAA(g, cx, cy, dot, col, outline, oc);
		break;
	case 3: // 圆环
		XhairCircleAA(g, cx, cy, length + gap, thick, col, outline, oc);
		maybeDot();
		break;
	case 4: // 圆环+点
		XhairCircleAA(g, cx, cy, length + gap, thick, col, outline, oc);
		maybeDot();
		break;
	case 5: // 圆环+十字
		XhairCircleAA(g, cx, cy, length + gap + thick, thick, col, outline, oc);
		cross();
		maybeDot();
		break;
	case 6: // T字
		tee();
		maybeDot();
		break;
	case 7: // T字+点
		tee();
		maybeDot();
		break;
	case 8: { // 方框
		const float r = length + gap;
		XhairRectAA(g, cx - r, cy - r, r * 2.f, r * 2.f, thick, col, outline, oc);
		maybeDot();
		break;
	}
	case 9: { // 方框+点
		const float r = length + gap;
		XhairRectAA(g, cx - r, cy - r, r * 2.f, r * 2.f, thick, col, outline, oc);
		maybeDot();
		break;
	}
	case 10: { // 菱形
		const float r = length + gap;
		if (outline > 0.f) {
			XhairStrokeLine(g, cx, cy - r, cx + r, cy, thick + outline * 2.f, oc);
			XhairStrokeLine(g, cx + r, cy, cx, cy + r, thick + outline * 2.f, oc);
			XhairStrokeLine(g, cx, cy + r, cx - r, cy, thick + outline * 2.f, oc);
			XhairStrokeLine(g, cx - r, cy, cx, cy - r, thick + outline * 2.f, oc);
		}
		XhairStrokeLine(g, cx, cy - r, cx + r, cy, thick, col);
		XhairStrokeLine(g, cx + r, cy, cx, cy + r, thick, col);
		XhairStrokeLine(g, cx, cy + r, cx - r, cy, thick, col);
		XhairStrokeLine(g, cx - r, cy, cx, cy - r, thick, col);
		maybeDot();
		break;
	}
	case 11: { // 人字
		const float r = length + gap;
		if (outline > 0.f) {
			XhairStrokeLine(g, cx, cy - r, cx - r, cy + r * 0.5f, thick + outline * 2.f, oc);
			XhairStrokeLine(g, cx, cy - r, cx + r, cy + r * 0.5f, thick + outline * 2.f, oc);
		}
		XhairStrokeLine(g, cx, cy - r, cx - r, cy + r * 0.5f, thick, col);
		XhairStrokeLine(g, cx, cy - r, cx + r, cy + r * 0.5f, thick, col);
		maybeDot();
		break;
	}
	case 12: { // 四角
		const float inn = gap;
		const float arm = length;
		auto corner = [&](float ix, float iy, float hx, float vy) {
			XhairArmAA(g, ix, iy, hx, 0.f, arm, thick, 0.f, col, outline, oc);
			XhairArmAA(g, ix, iy, 0.f, vy, arm, thick, 0.f, col, outline, oc);
		};
		corner(cx - inn, cy - inn, -1.f, -1.f);
		corner(cx + inn, cy - inn, 1.f, -1.f);
		corner(cx - inn, cy + inn, -1.f, 1.f);
		corner(cx + inn, cy + inn, 1.f, 1.f);
		maybeDot();
		break;
	}
	case 13: { // 双环
		const float outer = length + gap;
		float inner = outer - thick * 3.f - 2.f;
		if (inner < thick + 1.f) inner = outer * 0.55f;
		XhairCircleAA(g, cx, cy, outer, thick, col, outline, oc);
		XhairCircleAA(g, cx, cy, inner, thick, col, outline, oc);
		maybeDot();
		break;
	}
	case 14: // 横线
		XhairArmAA(g, cx, cy, 1.f, 0.f, length, thick, gap, col, outline, oc);
		XhairArmAA(g, cx, cy, -1.f, 0.f, length, thick, gap, col, outline, oc);
		maybeDot();
		break;
	case 15: { // 三角
		const float r = length + gap;
		const float x1 = cx, y1 = cy - r;
		const float x2 = cx - r * 0.86f, y2 = cy + r * 0.5f;
		const float x3 = cx + r * 0.86f, y3 = cy + r * 0.5f;
		if (outline > 0.f) {
			const float ot = thick + outline * 2.f;
			XhairStrokeLine(g, x1, y1, x2, y2, ot, oc);
			XhairStrokeLine(g, x2, y2, x3, y3, ot, oc);
			XhairStrokeLine(g, x3, y3, x1, y1, ot, oc);
		}
		XhairStrokeLine(g, x1, y1, x2, y2, thick, col);
		XhairStrokeLine(g, x2, y2, x3, y3, thick, col);
		XhairStrokeLine(g, x3, y3, x1, y1, thick, col);
		maybeDot();
		break;
	}
	case 16: // X字形
		xCross();
		maybeDot();
		break;
	case 17: // X字形+点
		xCross();
		maybeDot();
		break;
	case 18: // X字形+圆环
		xCross();
		XhairCircleAA(g, cx, cy, length + gap, thick, col, outline, oc);
		maybeDot();
		break;
	case 19: // X字形+圆环+点
		xCross();
		XhairCircleAA(g, cx, cy, length + gap, thick, col, outline, oc);
		maybeDot();
		break;
	default:
		cross();
		maybeDot();
		break;
	}
}

