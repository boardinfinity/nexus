import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, BookOpen, Clock, Award, Loader2, GraduationCap,
} from "lucide-react";
import { Link } from "wouter";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

const COURSE_TYPE_COLORS: Record<string, string> = {
  core: "bg-blue-100 text-blue-700 border-blue-200",
  major: "bg-purple-100 text-purple-700 border-purple-200",
  elective: "bg-green-100 text-green-700 border-green-200",
  capstone: "bg-amber-100 text-amber-700 border-amber-200",
  general_education: "bg-gray-100 text-gray-700 border-gray-200",
};

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#6366f1"];

const DEGREE_LABELS: Record<string, string> = {
  bachelor: "Bachelor's Degree",
  master: "Master's Degree",
  phd: "Doctorate",
  graduate_certificate: "Graduate Certificate",
  diploma: "Diploma",
};

interface ProgramDetail {
  id: string;
  name: string;
  degree_type: string;
  abbreviation: string | null;
  major: string | null;
  school_name: string | null;
  college_id: string;
  duration_years: number | null;
  total_credit_points: number | null;
  qf_emirates_level: number | null;
  delivery_mode: string | null;
  description: string | null;
  learning_outcomes: string[];
  intake_sessions: string[];
  courses: any[];
  skills: any[];
}

export default function ProgramDetail({ params }: { params: { id: string; pid: string } }) {
  const { id: collegeId, pid: programId } = params;

  const { data: program, isLoading } = useQuery<ProgramDetail>({
    queryKey: ["/api/colleges", collegeId, "programs", programId],
    queryFn: async () => {
      const res = await authFetch(`/api/colleges/${collegeId}/programs/${programId}`);
      if (!res.ok) throw new Error("Failed to fetch program");
      return res.json();
    },
  });

  const { data: skillCoverage } = useQuery<{ categories: any[] }>({
    queryKey: ["/api/college/skill-coverage", programId],
    queryFn: async () => {
      const res = await authFetch(`/api/college/skill-coverage/${programId}`);
      if (!res.ok) throw new Error("Failed to fetch skill coverage");
      return res.json();
    },
    enabled: !!programId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!program) return <div className="text-center py-20 text-muted-foreground">Program not found</div>;

  // Group courses by year
  const coursesByYear: Record<number, any[]> = {};
  for (const pc of program.courses || []) {
    const year = pc.year_of_study || 0;
    if (!coursesByYear[year]) coursesByYear[year] = [];
    coursesByYear[year].push(pc);
  }
  const years = Object.keys(coursesByYear).map(Number).sort();

  // Skill category donut data
  const categoryData = (skillCoverage?.categories || []).map((c: any, i: number) => ({
    name: c.name,
    value: c.skill_count,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));

  // Unique skills list
  const uniqueSkills = new Map<string, any>();
  for (const s of program.skills || []) {
    if (!uniqueSkills.has(s.skill_name)) {
      uniqueSkills.set(s.skill_name, s);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/colleges/${collegeId}`}>
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{program.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <Badge className="bg-blue-100 text-blue-700">{DEGREE_LABELS[program.degree_type] || program.degree_type}</Badge>
            {program.abbreviation && <Badge variant="outline">{program.abbreviation}</Badge>}
            {program.school_name && <span className="text-sm text-muted-foreground">{program.school_name}</span>}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        {program.duration_years && (
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-lg font-bold">{program.duration_years} years</p>
                <p className="text-xs text-muted-foreground">Duration</p>
              </div>
            </CardContent>
          </Card>
        )}
        {program.total_credit_points && (
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <Award className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-lg font-bold">{program.total_credit_points}</p>
                <p className="text-xs text-muted-foreground">Credit Points</p>
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-lg font-bold">{program.courses?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Courses</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <GraduationCap className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-lg font-bold">{uniqueSkills.size}</p>
              <p className="text-xs text-muted-foreground">Skills</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Description */}
      {program.description && (
        <Card>
          <CardHeader><CardTitle>Description</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">{program.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Learning Outcomes */}
      {program.learning_outcomes?.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Learning Outcomes</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {program.learning_outcomes.map((outcome, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-primary font-medium shrink-0">{i + 1}.</span>
                  <span className="text-muted-foreground">{outcome}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Course Journey */}
      <Card>
        <CardHeader><CardTitle>Course Journey</CardTitle></CardHeader>
        <CardContent>
          {years.length > 0 ? (
            <div className="space-y-6">
              {years.map((year) => (
                <div key={year}>
                  <h4 className="font-semibold mb-3">{year === 0 ? "Unassigned" : `Year ${year}`}</h4>
                  <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                    {coursesByYear[year].map((pc: any) => (
                      <div
                        key={pc.id}
                        className={`border rounded-lg p-3 cursor-pointer hover:shadow-sm transition-shadow ${COURSE_TYPE_COLORS[pc.course_type] || "bg-gray-50"}`}
                        onClick={() => window.location.hash = `#/colleges/${collegeId}/courses/${pc.course_id}`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-mono text-xs">{pc.college_courses?.code}</p>
                            <p className="text-sm font-medium mt-0.5">{pc.college_courses?.name}</p>
                          </div>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {pc.course_type?.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        {pc.recommended_term && (
                          <p className="text-xs mt-1 opacity-70">{pc.recommended_term}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm py-4">No courses mapped to this program yet</p>
          )}
        </CardContent>
      </Card>

      {/* Skill Profile */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Skill Profile</CardTitle></CardHeader>
          <CardContent>
            {categoryData.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {categoryData.map((entry: any, i: number) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm py-8 text-center">No skill data available</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>All Skills ({uniqueSkills.size})</CardTitle></CardHeader>
          <CardContent>
            <div className="max-h-[300px] overflow-y-auto space-y-1.5">
              {Array.from(uniqueSkills.values())
                .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
                .map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span>{s.skill_name}</span>
                      <Badge variant="secondary" className="text-[10px]">{s.skill_category}</Badge>
                    </div>
                    <div className="w-16 bg-muted rounded-full h-1.5">
                      <div
                        className="bg-primary rounded-full h-1.5"
                        style={{ width: `${(s.confidence || 0) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              {uniqueSkills.size === 0 && (
                <p className="text-muted-foreground text-sm py-4 text-center">No skills extracted yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
