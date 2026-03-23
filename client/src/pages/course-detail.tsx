import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, BookOpen, Loader2, Link2, Sparkles, Pencil, Trash2,
} from "lucide-react";
import { Link, useLocation } from "wouter";

interface CourseDetail {
  id: string;
  code: string;
  name: string;
  credit_points: number;
  description: string | null;
  hours_format: string | null;
  prerequisites: string | null;
  prerequisite_codes: string[];
  department_prefix: string | null;
  level: number | null;
  topics_covered: string[];
  skills: any[];
  programs: any[];
}

// ==================== Edit Course Dialog ====================
function EditCourseDialog({ open, onOpenChange, course, collegeId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: CourseDetail;
  collegeId: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [code, setCode] = useState(course.code);
  const [name, setName] = useState(course.name);
  const [creditPoints, setCreditPoints] = useState(course.credit_points?.toString() || "6");
  const [description, setDescription] = useState(course.description || "");
  const [prerequisites, setPrerequisites] = useState(course.prerequisites || "");
  const [hoursFormat, setHoursFormat] = useState(course.hours_format || "");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/colleges/${collegeId}/courses/${course.id}`, {
        code, name,
        credit_points: parseInt(creditPoints) || 6,
        description: description || null,
        prerequisites: prerequisites || null,
        hours_format: hoursFormat || null,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Course updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId, "courses", course.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId, "courses"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Course</DialogTitle>
          <DialogDescription>Update course details.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Code *</Label>
              <Input className="h-8 text-xs font-mono" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Credit Points</Label>
              <Input className="h-8 text-xs" type="number" value={creditPoints} onChange={(e) => setCreditPoints(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Name *</Label>
            <Input className="h-8 text-xs" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea className="text-xs min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Prerequisites</Label>
            <Input className="h-8 text-xs" placeholder="e.g. ACCY121 & ACCY122" value={prerequisites} onChange={(e) => setPrerequisites(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hours Format</Label>
            <Input className="h-8 text-xs" placeholder="e.g. L-2, T-2" value={hoursFormat} onChange={(e) => setHoursFormat(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!code || !name || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== Main Course Detail Page ====================
export default function CourseDetailPage({ params }: { params: { id: string; cid: string } }) {
  const { id: collegeId, cid: courseId } = params;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: course, isLoading } = useQuery<CourseDetail>({
    queryKey: ["/api/colleges", collegeId, "courses", courseId],
    queryFn: async () => {
      const res = await authFetch(`/api/colleges/${collegeId}/courses/${courseId}`);
      if (!res.ok) throw new Error("Failed to fetch course");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/colleges/${collegeId}/courses/${courseId}`);
    },
    onSuccess: () => {
      toast({ title: "Course deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId, "courses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId] });
      setLocation(`/colleges/${collegeId}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!course) return <div className="text-center py-20 text-muted-foreground">Course not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/colleges/${collegeId}`}>
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight font-mono">{course.code}</h1>
            <span className="text-2xl font-bold tracking-tight">— {course.name}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <Badge variant="secondary">{course.credit_points} credit points</Badge>
            {course.level && <Badge variant="outline">{course.level}-level</Badge>}
            {course.department_prefix && <Badge variant="outline">{course.department_prefix}</Badge>}
            {course.hours_format && <span className="text-sm text-muted-foreground">{course.hours_format}</span>}
          </div>
        </div>
      </div>

      {/* Description */}
      {course.description && (
        <Card>
          <CardHeader><CardTitle>Course Description</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">{course.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Prerequisites */}
      {course.prerequisites && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Prerequisites
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">{course.prerequisites}</p>
            {course.prerequisite_codes?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {course.prerequisite_codes.map((code) => (
                  <Badge key={code} variant="outline" className="font-mono">{code}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Topics */}
      {course.topics_covered?.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Topics Covered</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {course.topics_covered.map((topic, i) => (
                <Badge key={i} variant="secondary">{topic}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Extracted Skills */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Extracted Skills ({course.skills?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {course.skills?.length > 0 ? (
            <div className="space-y-2">
              {course.skills.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.skill_name}</span>
                    <Badge variant="secondary" className="text-[10px]">{s.skill_category}</Badge>
                    {s.taxonomy_skill_id && (
                      <Badge variant="outline" className="text-[10px] text-green-600">Mapped</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{Math.round((s.confidence || 0) * 100)}%</span>
                    <div className="w-20 bg-muted rounded-full h-2">
                      <div
                        className="bg-primary rounded-full h-2 transition-all"
                        style={{ width: `${(s.confidence || 0) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm py-4 text-center">No skills extracted yet</p>
          )}
        </CardContent>
      </Card>

      {/* Programs this course belongs to */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Programs ({course.programs?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {course.programs?.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Program</TableHead>
                  <TableHead>Degree Type</TableHead>
                  <TableHead>Course Type</TableHead>
                  <TableHead>Year</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {course.programs.map((p: any, i: number) => (
                  <TableRow
                    key={i}
                    className="cursor-pointer"
                    onClick={() => window.location.hash = `#/colleges/${collegeId}/programs/${p.id}`}
                  >
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell><Badge variant="secondary">{p.degree_type}</Badge></TableCell>
                    <TableCell>{p.course_type?.replace(/_/g, " ")}</TableCell>
                    <TableCell>{p.year_of_study || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm py-4 text-center">Not assigned to any programs</p>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      {editOpen && (
        <EditCourseDialog open={editOpen} onOpenChange={setEditOpen} course={course} collegeId={collegeId} />
      )}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Course</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{course.code} — {course.name}"? This action cannot be undone.
              {course.programs?.length > 0 && (
                <span className="block mt-2 font-medium text-destructive">
                  Warning: This course is assigned to {course.programs.length} program(s). It will be removed from all of them.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
