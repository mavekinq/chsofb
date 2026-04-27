export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      airline_terminal_rules: {
        Row: {
          airline_code: string
          created_at: string
          id: string
          is_active: boolean
          note: string | null
          terminal_code: string
          updated_at: string
        }
        Insert: {
          airline_code: string
          created_at?: string
          id?: string
          is_active?: boolean
          note?: string | null
          terminal_code: string
          updated_at?: string
        }
        Update: {
          airline_code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          note?: string | null
          terminal_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      action_logs: {
        Row: {
          action: string
          created_at: string
          details: string
          id: string
          performed_by: string
          wheelchair_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: string
          id?: string
          performed_by?: string
          wheelchair_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: string
          id?: string
          performed_by?: string
          wheelchair_id?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          staff_name: string
          started_at: string
          terminal: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          staff_name: string
          started_at?: string
          terminal?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          staff_name?: string
          started_at?: string
          terminal?: string
        }
        Relationships: []
      }
      work_schedule_state: {
        Row: {
          id: string
          payload: Json
          updated_at: string
        }
        Insert: {
          id: string
          payload: Json
          updated_at?: string
        }
        Update: {
          id?: string
          payload?: Json
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          is_active: boolean
          last_seen_at: string
          subscription: Json
          updated_at: string
          user_agent: string | null
          user_name: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          is_active?: boolean
          last_seen_at?: string
          subscription: Json
          updated_at?: string
          user_agent?: string | null
          user_name?: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          is_active?: boolean
          last_seen_at?: string
          subscription?: Json
          updated_at?: string
          user_agent?: string | null
          user_name?: string
        }
        Relationships: []
      }
      wheelchair_services: {
        Row: {
          assigned_staff: string
          created_at: string
          created_by: string
          flight_iata: string
          id: string
          notes: string
          passenger_type: string
          terminal: string
          wheelchair_id: string
        }
        Insert: {
          assigned_staff?: string
          created_at?: string
          created_by?: string
          flight_iata: string
          id?: string
          notes?: string
          passenger_type: string
          terminal?: string
          wheelchair_id: string
        }
        Update: {
          assigned_staff?: string
          created_at?: string
          created_by?: string
          flight_iata?: string
          id?: string
          notes?: string
          passenger_type?: string
          terminal?: string
          wheelchair_id?: string
        }
        Relationships: []
      }
      wheelchairs: {
        Row: {
          created_at: string
          gate: string
          id: string
          note: string | null
          status: string
          terminal: string
          updated_at: string
          wheelchair_id: string
        }
        Insert: {
          created_at?: string
          gate?: string
          id?: string
          note?: string | null
          status?: string
          terminal?: string
          updated_at?: string
          wheelchair_id: string
        }
        Update: {
          created_at?: string
          gate?: string
          id?: string
          note?: string | null
          status?: string
          terminal?: string
          updated_at?: string
          wheelchair_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_admin: boolean
          notification_enabled: boolean
          security_number: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          is_admin?: boolean
          notification_enabled?: boolean
          security_number?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_admin?: boolean
          notification_enabled?: boolean
          security_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
