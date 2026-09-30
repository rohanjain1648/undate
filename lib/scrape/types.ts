export type LinkedInData = {
  url: string;
  name: string;
  headline: string;
  location: string;
  about: string;
  photo: string | null;
  experience: { title: string; company: string; duration: string; description: string }[];
  education: { school: string; degree: string; field: string }[];
  skills: string[];
  languages: string[];
  volunteering: string[];
  certifications: string[];
  posts: string[];
  follows: string[]; // "interests" section: people, companies, groups, schools they follow
  extras: string[]; // causes, projects, honors, organizations, featured items
};

export type InstagramPost = {
  caption: string;
  hashtags: string[];
  location: string;
  timestamp: string;
  type: string;
  imageUrl: string | null;
  url: string;
  likes: number | null;
};

export type InstagramData = {
  url: string;
  username: string;
  fullName: string;
  bio: string;
  externalUrl: string;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  isPrivate: boolean;
  isVerified: boolean;
  category: string;
  profilePic: string | null;
  posts: InstagramPost[];
};
