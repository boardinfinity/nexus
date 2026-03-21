import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { sendOtp, verifyOtp, setSurveyToken, hasSurveyToken } from "@/lib/survey-api";
import { Loader2, Mail, ClipboardCheck, ArrowRight, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function SurveyLanding() {
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // If already authenticated, redirect to form
  useEffect(() => {
    if (hasSurveyToken()) {
      navigate("/survey/form");
    }
  }, [navigate]);

  const handleSendOtp = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      toast({ title: "Email required", description: "Please enter your email address.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await sendOtp(trimmed);
      setStep("otp");
      toast({ title: "Code sent", description: `Check your inbox at ${trimmed}` });
    } catch (err: any) {
      toast({ title: "Failed to send code", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length < 6) {
      toast({ title: "Enter full code", description: "Please enter the 6-digit code.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const result = await verifyOtp(email.trim().toLowerCase(), otp);
      setSurveyToken(result.token);
      toast({ title: "Verified", description: "Welcome to the survey!" });
      navigate("/survey/form");
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setLoading(true);
    try {
      await sendOtp(email.trim().toLowerCase());
      setOtp("");
      toast({ title: "Code resent", description: "Check your inbox for a new code." });
    } catch (err: any) {
      toast({ title: "Failed to resend", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2 mb-2">
            <ClipboardCheck className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Nexus Industry Expert Survey</h1>
          <p className="text-sm text-muted-foreground">Board Infinity &mdash; Skills Intelligence Research</p>
          <div className="border-t pt-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Help us understand what skills matter most for MBA graduates in today's workforce.
              <br />
              <span className="text-xs opacity-75">Estimated time: ~12 minutes</span>
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">
              {step === "email" ? "Enter your email to begin" : "Enter verification code"}
            </CardTitle>
            {step === "otp" && (
              <p className="text-xs text-muted-foreground">
                A 6-digit code was sent to {email}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {step === "email" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="survey-email" className="text-xs">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="survey-email"
                      type="email"
                      placeholder="your@company.com"
                      className="pl-9"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                      autoFocus
                    />
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <span className="text-amber-500">Tip:</span> Please use your official company email address for verification.
                  </p>
                </div>
                <Button className="w-full" onClick={handleSendOtp} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                  Send Code
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <Label className="text-xs">6-Digit Code</Label>
                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={6}
                      value={otp}
                      onChange={(val) => setOtp(val)}
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                      </InputOTPGroup>
                      <span className="mx-2 text-muted-foreground">-</span>
                      <InputOTPGroup>
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                </div>
                <Button className="w-full" onClick={handleVerifyOtp} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                  Verify & Enter Survey
                </Button>
                <Button variant="ghost" className="w-full text-xs" onClick={handleResend} disabled={loading}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Resend Code
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
